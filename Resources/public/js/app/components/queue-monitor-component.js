import $ from 'jquery';
import __ from 'orotranslation/js/translator';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import BaseComponent from 'oroui/js/app/components/base/component';
const REFRESH_INTERVAL_MS = 5000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_PREVIEW_MESSAGES = 10;
// Absolute safety ceiling for a single preview fetch; the effective limit comes from
// configuration (queue_monitor_max_message_fetch, default 100) via the maxMessageFetch option.
const MAX_PREVIEW_MESSAGES = 1000;
const DEFAULT_MAX_MESSAGE_FETCH = 100;
// Distinct palette for per-queue line colours (8 well-separated swatches).
const PALETTE = [
    '#2b84ed', '#e6492d', '#27ae60', '#f39c12',
    '#8e44ad', '#16a085', '#d81b60', '#34495e'
];
/**
 * Queue Monitor page component: lists RabbitMQ queues (outstanding messages + consumers),
 * lets the user select one or many queues (each with a chosen colour), and plots their
 * recent message-count history as a multi-series line chart (with a maximize mode showing a
 * Y axis). Messages can be previewed non-destructively (fetched and immediately requeued).
 *
 * NOTE: instance state is initialised inside initialize() (not via class field initializers).
 */
class QueueMonitorComponent extends BaseComponent {
    initialize(options) {
        this.$el = options._sourceElement;
        this.queuesUrl = options.queuesUrl;
        this.queueUrlTemplate = options.queueUrlTemplate;
        this.messagesUrlTemplate = options.messagesUrlTemplate;
        this.allowMultiselect = options.allowMultiselect !== false;
        this.allowColorSelection = options.allowColorSelection !== false;
        this.allowMessagePreview = options.allowMessagePreview !== false;
        this.historySamples = options.historySamples && options.historySamples > 0 ? options.historySamples : 15;
        this.maxMessageFetch = options.maxMessageFetch && options.maxMessageFetch > 0
            ? Math.min(options.maxMessageFetch, MAX_PREVIEW_MESSAGES)
            : DEFAULT_MAX_MESSAGE_FETCH;
        this.queues = [];
        this.filterText = '';
        this.selected = new Set();
        this.colors = {};
        this.details = {};
        this.maximized = false;
        this.refreshTimer = null;
        this.resizeRaf = null;
        this.bindEvents();
        this.initSplitter();
        this.loadQueues(false, true);
        this.startAutoRefresh();
    }
    bindEvents() {
        this.$el.on('click.aaxisQueueMon', '[data-role="queue-toggle"]', this.onQueueToggle.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="color-swatch"]', this.onColorSwatch.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="palette-color"]', this.onPaletteColor.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="select-all"]', this.onSelectAll.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="select-none"]', this.onSelectNone.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="maximize"]', this.onToggleMaximize.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="refresh"]', this.onRefresh.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="filter-clear"]', this.onFilterClear.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="help"]', this.onHelp.bind(this));
        this.$el.on('click.aaxisQueueMon', '[data-role="preview"]', this.onPreview.bind(this));
        this.$el.on('change.aaxisQueueMon', '[data-role="autorefresh"]', this.onToggleAutoRefresh.bind(this));
        this.$el.on('input.aaxisQueueMon', '[data-role="filter"]', (e) => {
            this.filterText = String(e.currentTarget.value || '').toLowerCase();
            this.updateFilterClear();
            this.renderQueues();
        });
        // Close any open colour palette when clicking elsewhere.
        $(document).on('mousedown.aaxisQueueMonPalette', (e) => {
            if (!$(e.target).closest('[data-role="palette"], [data-role="color-swatch"]').length) {
                this.$el.find('[data-role="palette"]').prop('hidden', true);
            }
        });
        $(window).on('resize.aaxisQueueMon', () => {
            if (this.resizeRaf !== null) {
                window.cancelAnimationFrame(this.resizeRaf);
            }
            this.resizeRaf = window.requestAnimationFrame(() => this.renderChart());
        });
    }
    // --- Auto refresh --------------------------------------------------------
    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshTimer = window.setInterval(() => {
            this.loadQueues(true, false);
            this.loadDetails(true);
        }, REFRESH_INTERVAL_MS);
    }
    stopAutoRefresh() {
        if (this.refreshTimer !== null) {
            window.clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
    onToggleAutoRefresh(event) {
        if (event.currentTarget.checked) {
            this.startAutoRefresh();
        }
        else {
            this.stopAutoRefresh();
        }
    }
    // --- Colours -------------------------------------------------------------
    colorFor(name, index) {
        if (!this.colors[name]) {
            this.colors[name] = PALETTE[index % PALETTE.length];
        }
        return this.colors[name];
    }
    // --- Queue list ----------------------------------------------------------
    loadQueues(silent, selectDefault) {
        $.ajax({ url: this.queuesUrl, method: 'GET' })
            .done((response) => {
            this.queues = response.queues || [];
            // Pre-assign a stable colour to every queue based on its position.
            this.queues.forEach((queue, index) => this.colorFor(queue.name, index));
            if (selectDefault && this.selected.size === 0 && this.queues.length > 0) {
                this.selected.add(this.queues[0].name);
                this.renderDetailStructure();
                this.loadDetails(false);
            }
            this.renderQueues();
        })
            .fail((jqXhr) => {
            if (!silent) {
                const message = (jqXhr.responseJSON && jqXhr.responseJSON.message)
                    || __('aaxis.tools.queue_monitor.queues_error');
                this.$el.find('[data-role="queues"]').empty().append($('<li/>', { 'class': 'aaxis-queue-mon__empty' }).text(message));
            }
        });
    }
    renderQueues() {
        const $list = this.$el.find('[data-role="queues"]').empty();
        const visible = this.queues.filter(queue => this.filterText === '' || queue.name.toLowerCase().indexOf(this.filterText) !== -1);
        if (visible.length === 0) {
            $list.append($('<li/>', { 'class': 'aaxis-queue-mon__empty' })
                .text(__('aaxis.tools.queue_monitor.no_queues')));
            return;
        }
        visible.forEach(queue => {
            const index = this.queues.indexOf(queue);
            const color = this.colorFor(queue.name, index < 0 ? 0 : index);
            const isSelected = this.selected.has(queue.name);
            const $row = $('<div/>', {
                'class': 'aaxis-queue-mon__queue' + (isSelected ? ' is-selected' : '')
            });
            // Selection toggle (checkbox-like) — only shown in multi-select mode.
            if (this.allowMultiselect) {
                $row.append($('<span/>', {
                    'class': 'aaxis-queue-mon__check fa ' + (isSelected ? 'fa-check-square' : 'fa-square-o'),
                    'data-role': 'queue-toggle',
                    'data-name': queue.name,
                    'aria-hidden': 'true'
                }));
            }
            // Colour swatch + palette popover (only when colour selection is allowed).
            if (this.allowColorSelection) {
                const $swatchWrap = $('<span/>', { 'class': 'aaxis-queue-mon__swatch-wrap' });
                $swatchWrap.append($('<button/>', {
                    type: 'button',
                    'class': 'aaxis-queue-mon__swatch',
                    'data-role': 'color-swatch',
                    'data-name': queue.name,
                    title: __('aaxis.tools.queue_monitor.color'),
                    style: 'background:' + color
                }));
                $swatchWrap.append(this.buildPalette(queue.name));
                $row.append($swatchWrap);
            }
            else {
                // Static colour dot so the legend mapping is still visible.
                $row.append($('<span/>', {
                    'class': 'aaxis-queue-mon__swatch is-static',
                    style: 'background:' + color
                }));
            }
            // Name + badges (also toggles selection).
            const $main = $('<span/>', {
                'class': 'aaxis-queue-mon__queue-main',
                'data-role': 'queue-toggle',
                'data-name': queue.name,
                title: queue.name
            });
            $main.append($('<span/>', { 'class': 'aaxis-queue-mon__queue-name', text: queue.name }));
            const $badges = $('<span/>', { 'class': 'aaxis-queue-mon__queue-badges' });
            $badges.append(this.badge('ready', queue.messagesReady, __('aaxis.tools.queue_monitor.ready')));
            $badges.append(this.badge('unacked', queue.messagesUnacked, __('aaxis.tools.queue_monitor.unacked')));
            $badges.append(this.badge('consumers', queue.consumers, __('aaxis.tools.queue_monitor.consumers')));
            $main.append($badges);
            $row.append($main);
            $list.append($('<li/>').append($row));
        });
    }
    buildPalette(name) {
        const $palette = $('<div/>', {
            'class': 'aaxis-queue-mon__palette',
            'data-role': 'palette',
            'data-name': name,
            hidden: true
        });
        PALETTE.forEach(color => {
            $palette.append($('<button/>', {
                type: 'button',
                'class': 'aaxis-queue-mon__palette-cell',
                'data-role': 'palette-color',
                'data-name': name,
                'data-color': color,
                style: 'background:' + color,
                'aria-label': color
            }));
        });
        return $palette;
    }
    badge(kind, value, label) {
        return $('<span/>', {
            'class': 'aaxis-queue-mon__badge is-' + kind + (value > 0 ? ' has-value' : ''),
            title: label
        }).append($('<span/>', { 'class': 'aaxis-queue-mon__badge-label', text: label }), $('<span/>', { 'class': 'aaxis-queue-mon__badge-value', text: String(value) }));
    }
    // --- Selection -----------------------------------------------------------
    onQueueToggle(event) {
        event.preventDefault();
        const name = String($(event.currentTarget).data('name'));
        if (!this.allowMultiselect) {
            // Single-select: clicking a queue replaces the current selection.
            if (this.selected.has(name) && this.selected.size === 1) {
                return;
            }
            this.selected = new Set([name]);
            this.details = {};
            this.renderQueues();
            this.renderDetailStructure();
            this.loadDetails(false);
            return;
        }
        if (this.selected.has(name)) {
            this.selected.delete(name);
            delete this.details[name];
        }
        else {
            this.selected.add(name);
        }
        this.renderQueues();
        this.renderDetailStructure();
        this.loadDetails(false);
    }
    onSelectAll(event) {
        event.preventDefault();
        this.queues
            .filter(queue => this.filterText === '' || queue.name.toLowerCase().indexOf(this.filterText) !== -1)
            .forEach(queue => this.selected.add(queue.name));
        this.renderQueues();
        this.renderDetailStructure();
        this.loadDetails(false);
    }
    onSelectNone(event) {
        event.preventDefault();
        this.selected.clear();
        this.details = {};
        this.renderQueues();
        this.renderDetailStructure();
    }
    onColorSwatch(event) {
        event.preventDefault();
        event.stopPropagation();
        const name = String($(event.currentTarget).data('name'));
        const $palette = this.$el.find('[data-role="palette"][data-name="' + this.cssEscape(name) + '"]');
        const willShow = $palette.prop('hidden');
        this.$el.find('[data-role="palette"]').prop('hidden', true);
        $palette.prop('hidden', !willShow);
    }
    onPaletteColor(event) {
        event.preventDefault();
        event.stopPropagation();
        const $target = $(event.currentTarget);
        const name = String($target.data('name'));
        this.colors[name] = String($target.data('color'));
        this.$el.find('[data-role="palette"]').prop('hidden', true);
        this.renderQueues();
        if (this.selected.has(name)) {
            this.updateDynamic();
        }
    }
    cssEscape(value) {
        return value.replace(/["\\]/g, '\\$&');
    }
    // --- Detail fetching -----------------------------------------------------
    queueUrl(name) {
        return this.queueUrlTemplate.replace('__NAME__', encodeURIComponent(name));
    }
    messagesUrl(name) {
        return this.messagesUrlTemplate.replace('__NAME__', encodeURIComponent(name));
    }
    loadDetails(silent) {
        const names = Array.from(this.selected);
        if (names.length === 0) {
            return;
        }
        Promise.all(names.map(name => new Promise(resolve => {
            $.ajax({ url: this.queueUrl(name), method: 'GET' })
                .done((response) => {
                if (response.queue) {
                    this.details[name] = response.queue;
                }
            })
                .always(() => resolve());
        }))).then(() => {
            // Prune details for queues no longer selected.
            Object.keys(this.details).forEach(name => {
                if (!this.selected.has(name)) {
                    delete this.details[name];
                }
            });
            this.updateDynamic();
        }).catch(() => {
            if (!silent) {
                this.$el.find('[data-role="detail"]').empty().append($('<div/>', { 'class': 'alert alert-error', role: 'alert' })
                    .text(__('aaxis.tools.queue_monitor.queue_error')));
            }
        });
    }
    // --- Detail structure ----------------------------------------------------
    orderedSelected() {
        return this.queues.map(q => q.name).filter(name => this.selected.has(name));
    }
    /**
     * Whether RabbitMQ's metrics collector is off for the selected queues. When it is,
     * the API returns no length-history detail objects, so no samples can be shown.
     */
    samplesDisabled() {
        const loaded = this.orderedSelected()
            .map(name => this.details[name])
            .filter((detail) => !!detail);
        return loaded.length > 0 && loaded.every(detail => detail.samplesAvailable === false);
    }
    emptyHistoryMessage() {
        return this.samplesDisabled()
            ? __('aaxis.tools.queue_monitor.samples_disabled')
            : __('aaxis.tools.queue_monitor.no_history');
    }
    renderDetailStructure() {
        const $detail = this.$el.find('[data-role="detail"]').empty();
        this.$el.find('[data-role="layout"]').toggleClass('is-maximized', this.maximized);
        if (this.selected.size === 0) {
            this.maximized = false;
            this.$el.find('[data-role="layout"]').removeClass('is-maximized');
            $detail.append($('<div/>', {
                'class': 'aaxis-queue-mon__placeholder',
                text: __('aaxis.tools.queue_monitor.no_selection')
            }));
            return;
        }
        // History section: header (title + maximize) + stats/legend + chart.
        const $section = $('<div/>', { 'class': 'aaxis-queue-mon__history-section' });
        const $header = $('<div/>', { 'class': 'aaxis-queue-mon__history-header' });
        $header.append($('<h3/>', {
            'class': 'aaxis-queue-mon__section-title',
            text: __('aaxis.tools.queue_monitor.history_title')
        }));
        $header.append($('<button/>', {
            type: 'button',
            'class': 'aaxis-queue-mon__maximize',
            'data-role': 'maximize',
            title: this.maximized
                ? __('aaxis.tools.queue_monitor.minimize')
                : __('aaxis.tools.queue_monitor.maximize')
        }).append($('<span/>', {
            'class': 'fa ' + (this.maximized ? 'fa-compress' : 'fa-expand'),
            'aria-hidden': 'true'
        })));
        $section.append($header);
        $section.append($('<div/>', { 'data-role': 'stats', 'class': 'aaxis-queue-mon__legend' }));
        $section.append($('<div/>', { 'data-role': 'chart', 'class': 'aaxis-queue-mon__chart' }));
        $detail.append($section);
        // Below the graph: recent samples (left) + message preview (right).
        const $cols = $('<div/>', { 'class': 'aaxis-queue-mon__cols', 'data-role': 'cols' });
        const $left = $('<div/>', { 'class': 'aaxis-queue-mon__col' });
        $left.append($('<h3/>', {
            'class': 'aaxis-queue-mon__section-title',
            text: __('aaxis.tools.queue_monitor.samples_title')
        }));
        $left.append($('<div/>', { 'data-role': 'samples' }));
        $cols.append($left);
        if (this.allowMessagePreview) {
            const $right = $('<div/>', { 'class': 'aaxis-queue-mon__col' });
            $right.append($('<h3/>', {
                'class': 'aaxis-queue-mon__section-title',
                text: __('aaxis.tools.queue_monitor.messages_title')
            }));
            const $previewBar = $('<div/>', { 'class': 'aaxis-queue-mon__preview-bar' });
            const $select = $('<select/>', {
                'class': 'form-control aaxis-queue-mon__preview-select',
                'data-role': 'preview-queue'
            });
            this.orderedSelected().forEach(name => $select.append($('<option/>', { value: name, text: name })));
            $previewBar.append($select);
            $previewBar.append($('<input/>', {
                type: 'number',
                'class': 'form-control aaxis-queue-mon__preview-count',
                'data-role': 'preview-count',
                min: 1,
                max: this.maxMessageFetch,
                value: Math.min(DEFAULT_PREVIEW_MESSAGES, this.maxMessageFetch),
                title: __('aaxis.tools.queue_monitor.preview_count_title', { max: this.maxMessageFetch })
            }));
            $previewBar.append($('<button/>', {
                type: 'button',
                'class': 'btn',
                'data-role': 'preview',
                text: __('aaxis.tools.queue_monitor.preview_btn')
            }));
            $right.append($previewBar);
            $right.append($('<div/>', {
                'class': 'aaxis-queue-mon__preview-note',
                text: __('aaxis.tools.queue_monitor.preview_note')
            }));
            $right.append($('<div/>', { 'data-role': 'messages', 'class': 'aaxis-queue-mon__messages' }));
            $cols.append($right);
        }
        $detail.append($cols);
        this.updateDynamic();
    }
    onToggleMaximize(event) {
        event.preventDefault();
        this.maximized = !this.maximized;
        this.$el.find('[data-role="layout"]').toggleClass('is-maximized', this.maximized);
        const $btn = this.$el.find('[data-role="maximize"]');
        $btn.attr('title', this.maximized
            ? __('aaxis.tools.queue_monitor.minimize')
            : __('aaxis.tools.queue_monitor.maximize'));
        $btn.find('.fa').attr('class', 'fa ' + (this.maximized ? 'fa-compress' : 'fa-expand'));
        window.requestAnimationFrame(() => this.renderChart());
    }
    // --- Dynamic parts (refreshed without losing the message preview) --------
    updateDynamic() {
        if (this.selected.size === 0) {
            return;
        }
        this.renderLegendStats();
        this.renderChart();
        this.renderSamplesTable();
    }
    renderLegendStats() {
        const $stats = this.$el.find('[data-role="stats"]');
        if (!$stats.length) {
            return;
        }
        $stats.empty();
        const $table = $('<table/>', { 'class': 'grid table table-bordered table-condensed aaxis-queue-mon__legend-table' });
        const $head = $('<tr/>').appendTo($('<thead/>').appendTo($table));
        ['', __('aaxis.tools.queue_monitor.queue'), __('aaxis.tools.queue_monitor.messages'),
            __('aaxis.tools.queue_monitor.ready'), __('aaxis.tools.queue_monitor.unacked'),
            __('aaxis.tools.queue_monitor.consumers')]
            .forEach(label => $head.append($('<th/>', { text: label })));
        const $body = $('<tbody/>').appendTo($table);
        this.orderedSelected().forEach((name, idx) => {
            const detail = this.details[name];
            const color = this.colorFor(name, this.queues.findIndex(q => q.name === name));
            const $tr = $('<tr/>').appendTo($body);
            $tr.append($('<td/>').append($('<span/>', {
                'class': 'aaxis-queue-mon__legend-swatch',
                style: 'background:' + color
            })));
            $tr.append($('<td/>', { 'class': 'aaxis-queue-mon__legend-name', text: name }));
            $tr.append($('<td/>', { text: detail ? String(detail.messages) : '-' }));
            $tr.append($('<td/>', { text: detail ? String(detail.messagesReady) : '-' }));
            $tr.append($('<td/>', { text: detail ? String(detail.messagesUnacked) : '-' }));
            $tr.append($('<td/>', { text: detail ? String(detail.consumers) : '-' }));
        });
        $stats.append($table);
    }
    // --- Multi-series chart --------------------------------------------------
    seriesPoints(detail) {
        if (!detail) {
            return [];
        }
        return (detail.samples || [])
            .map(sample => ({
            timestamp: sample.timestamp,
            value: sample.total ?? ((sample.ready ?? 0) + (sample.unacked ?? 0))
        }))
            .filter(point => Number.isFinite(point.timestamp))
            .sort((a, b) => a.timestamp - b.timestamp);
    }
    renderChart() {
        const container = this.$el.find('[data-role="chart"]').get(0);
        if (!container) {
            return;
        }
        const series = this.orderedSelected().map(name => ({
            name,
            color: this.colorFor(name, this.queues.findIndex(q => q.name === name)),
            points: this.seriesPoints(this.details[name])
        })).filter(s => s.points.length > 0);
        $(container).empty();
        if (series.length === 0) {
            $(container).append($('<p/>', { 'class': 'aaxis-queue-mon__empty' })
                .text(this.emptyHistoryMessage()));
            return;
        }
        const rect = container.getBoundingClientRect();
        const width = Math.max(Math.round(rect.width), 260);
        const height = Math.max(Math.round(rect.height), this.maximized ? 240 : 160);
        const padTop = 10;
        const padBottom = 18;
        const padLeft = this.maximized ? 48 : 10;
        const padRight = 12;
        let tMin = Infinity;
        let tMax = -Infinity;
        let vMax = 1;
        series.forEach(s => s.points.forEach(p => {
            tMin = Math.min(tMin, p.timestamp);
            tMax = Math.max(tMax, p.timestamp);
            vMax = Math.max(vMax, p.value);
        }));
        const x = (t) => tMax === tMin
            ? padLeft
            : padLeft + ((t - tMin) / (tMax - tMin)) * (width - padLeft - padRight);
        const y = (v) => height - padBottom - (v / vMax) * (height - padTop - padBottom);
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'aaxis-queue-mon__chart-svg');
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        // Horizontal gridlines (and Y-axis captions when maximized): 5 levels.
        const levels = 4;
        for (let i = 0; i <= levels; i++) {
            const value = Math.round((vMax * (levels - i)) / levels);
            const gy = padTop + (i / levels) * (height - padTop - padBottom);
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', String(padLeft));
            line.setAttribute('y1', gy.toFixed(1));
            line.setAttribute('x2', String(width - padRight));
            line.setAttribute('y2', gy.toFixed(1));
            line.setAttribute('stroke', '#e2e2e2');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
            if (this.maximized) {
                const label = document.createElementNS(SVG_NS, 'text');
                label.setAttribute('x', String(padLeft - 6));
                label.setAttribute('y', (gy + 3).toFixed(1));
                label.setAttribute('text-anchor', 'end');
                label.setAttribute('font-size', '11');
                label.setAttribute('fill', '#8a98a6');
                label.textContent = String(value);
                svg.appendChild(label);
            }
        }
        // One polyline per selected queue, in its colour.
        series.forEach(s => {
            const coords = s.points.map(p => x(p.timestamp).toFixed(1) + ',' + y(p.value).toFixed(1));
            const polyline = document.createElementNS(SVG_NS, 'polyline');
            polyline.setAttribute('points', coords.join(' '));
            polyline.setAttribute('fill', 'none');
            polyline.setAttribute('stroke', s.color);
            polyline.setAttribute('stroke-width', '2');
            polyline.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(polyline);
        });
        container.appendChild(svg);
        const start = new Date(tMin).toLocaleTimeString();
        const end = new Date(tMax).toLocaleTimeString();
        $(container).append($('<div/>', {
            'class': 'aaxis-queue-mon__chart-caption',
            text: __('aaxis.tools.queue_monitor.chart_caption', { start, end, max: vMax })
        }));
    }
    renderSamplesTable() {
        const $samples = this.$el.find('[data-role="samples"]');
        if (!$samples.length) {
            return;
        }
        $samples.empty();
        const order = this.orderedSelected();
        const byTs = {};
        order.forEach(name => {
            this.seriesPoints(this.details[name]).forEach(p => {
                byTs[p.timestamp] = byTs[p.timestamp] || {};
                byTs[p.timestamp][name] = p.value;
            });
        });
        const timestamps = Object.keys(byTs).map(Number).sort((a, b) => b - a).slice(0, this.historySamples);
        if (timestamps.length === 0) {
            $samples.append($('<p/>', { 'class': 'aaxis-queue-mon__empty' })
                .text(this.emptyHistoryMessage()));
            return;
        }
        const $table = $('<table/>', { 'class': 'grid table table-bordered table-condensed aaxis-queue-mon__history-table' });
        const $head = $('<tr/>').appendTo($('<thead/>').appendTo($table));
        $head.append($('<th/>', { text: __('aaxis.tools.queue_monitor.sample_time') }));
        order.forEach(name => {
            const color = this.colorFor(name, this.queues.findIndex(q => q.name === name));
            $head.append($('<th/>').append($('<span/>', { 'class': 'aaxis-queue-mon__legend-swatch', style: 'background:' + color }), $('<span/>', { text: name })));
        });
        const $body = $('<tbody/>').appendTo($table);
        timestamps.forEach(ts => {
            const $tr = $('<tr/>').appendTo($body);
            $tr.append($('<td/>', { text: new Date(ts).toLocaleString() }));
            order.forEach(name => {
                const value = byTs[ts][name];
                $tr.append($('<td/>', { text: value === undefined ? '-' : String(value) }));
            });
        });
        $samples.append($table);
    }
    // --- Message preview -----------------------------------------------------
    onPreview(event) {
        event.preventDefault();
        const name = String(this.$el.find('[data-role="preview-queue"]').val() || '');
        if (name === '') {
            return;
        }
        const $btn = $(event.currentTarget);
        $btn.prop('disabled', true);
        let count = parseInt(String(this.$el.find('[data-role="preview-count"]').val() || ''), 10);
        if (!Number.isFinite(count) || count < 1) {
            count = Math.min(DEFAULT_PREVIEW_MESSAGES, this.maxMessageFetch);
        }
        count = Math.min(count, this.maxMessageFetch);
        this.$el.find('[data-role="preview-count"]').val(count);
        const $messages = this.$el.find('[data-role="messages"]').empty().append($('<p/>', { 'class': 'aaxis-queue-mon__empty', text: __('aaxis.tools.queue_monitor.loading') }));
        fetch(this.messagesUrl(name), {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Header': this.getCsrfToken()
            },
            body: JSON.stringify({ count })
        }).then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
            if (!ok) {
                throw new Error((data && data.message) || 'error');
            }
            this.renderMessages($messages, (data.messages || []));
        })
            .catch(() => {
            $messages.empty().append($('<div/>', { 'class': 'alert alert-error', role: 'alert' })
                .text(__('aaxis.tools.queue_monitor.preview_error')));
        })
            .finally(() => $btn.prop('disabled', false));
    }
    renderMessages($container, messages) {
        $container.empty();
        if (messages.length === 0) {
            $container.append($('<p/>', { 'class': 'aaxis-queue-mon__empty' })
                .text(__('aaxis.tools.queue_monitor.no_messages')));
            return;
        }
        messages.forEach((message, index) => {
            const $msg = $('<div/>', { 'class': 'aaxis-queue-mon__message' });
            const $head = $('<div/>', { 'class': 'aaxis-queue-mon__message-head' });
            $head.append($('<span/>', { 'class': 'aaxis-queue-mon__message-index', text: '#' + (index + 1) }));
            if (message.routingKey) {
                $head.append($('<span/>', {
                    'class': 'aaxis-queue-mon__message-meta',
                    text: __('aaxis.tools.queue_monitor.routing_key') + ': ' + message.routingKey
                }));
            }
            $head.append($('<span/>', { 'class': 'aaxis-queue-mon__message-meta', text: message.payloadBytes + ' B' }));
            const body = this.prettyPayload(message.payload);
            const $copy = $('<button/>', {
                type: 'button',
                'class': 'aaxis-queue-mon__message-copy',
                title: __('aaxis.tools.queue_monitor.copy'),
                'aria-label': __('aaxis.tools.queue_monitor.copy')
            }).append($('<span/>', { 'class': 'fa fa-clipboard', 'aria-hidden': 'true' }));
            $copy.on('click', (e) => {
                e.preventDefault();
                this.copyToClipboard(body);
            });
            $head.append($copy);
            $msg.append($head);
            const $pre = $('<pre/>', { 'class': 'aaxis-queue-mon__message-body' });
            $pre.text(body);
            $msg.append($pre);
            $container.append($msg);
        });
    }
    copyToClipboard(text) {
        const onSuccess = () => messenger.notificationFlashMessage('success', __('aaxis.tools.queue_monitor.copied'));
        const onError = () => messenger.notificationFlashMessage('error', __('aaxis.tools.queue_monitor.copy_error'));
        if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
            window.navigator.clipboard.writeText(text).then(onSuccess).catch(onError);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            onSuccess();
        }
        catch (e) {
            onError();
        }
        document.body.removeChild(textarea);
    }
    prettyPayload(payload) {
        try {
            return JSON.stringify(JSON.parse(payload), null, 2);
        }
        catch (e) {
            return payload;
        }
    }
    // --- Misc ----------------------------------------------------------------
    onRefresh(event) {
        event.preventDefault();
        this.loadQueues(false, false);
        this.loadDetails(false);
    }
    onFilterClear(event) {
        event.preventDefault();
        const $input = this.$el.find('[data-role="filter"]');
        $input.val('');
        this.filterText = '';
        this.updateFilterClear();
        this.renderQueues();
        $input.trigger('focus');
    }
    updateFilterClear() {
        this.$el.find('[data-role="filter-clear"]').prop('hidden', this.filterText === '');
    }
    initSplitter() {
        const sidebar = this.$el.find('[data-role="sidebar"]').get(0);
        this.$el.on('mousedown.aaxisQueueMon', '[data-role="v-splitter"]', (event) => {
            event.preventDefault();
            const startX = event.clientX;
            const startSize = sidebar ? sidebar.getBoundingClientRect().width : 0;
            $('body').addClass('aaxis-queue-mon-resizing');
            const move = (e) => {
                if (!sidebar) {
                    return;
                }
                const width = Math.min(Math.max(startSize + (e.clientX - startX), 220), 760);
                sidebar.style.flex = '0 0 ' + width + 'px';
            };
            const up = () => {
                $(document).off('mousemove.aaxisQueueMonDrag mouseup.aaxisQueueMonDrag');
                $('body').removeClass('aaxis-queue-mon-resizing');
                this.renderChart();
            };
            $(document)
                .on('mousemove.aaxisQueueMonDrag', move)
                .on('mouseup.aaxisQueueMonDrag', up);
        });
    }
    onHelp(event) {
        event.preventDefault();
        const html = this.$el.find('[data-role="help-content"]').html();
        const modal = new Modal({
            title: __('aaxis.tools.queue_monitor.help'),
            content: html,
            allowOk: false,
            cancelText: __('Close')
        });
        modal.open();
    }
    getCsrfToken() {
        const name = window.location.protocol === 'https:' ? 'https-_csrf' : '_csrf';
        const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : '';
    }
    dispose() {
        if (this.disposed) {
            return;
        }
        this.stopAutoRefresh();
        if (this.resizeRaf !== null) {
            window.cancelAnimationFrame(this.resizeRaf);
        }
        this.$el.off('.aaxisQueueMon');
        $(document).off('.aaxisQueueMonDrag .aaxisQueueMonPalette');
        $(window).off('.aaxisQueueMon');
        $('body').removeClass('aaxis-queue-mon-resizing');
        super.dispose();
    }
}
export default QueueMonitorComponent;
