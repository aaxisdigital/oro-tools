import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import {MARKUP, URLS, createComponent, detail, mockServer, queue, type FakeServer} from './support/queue-monitor';

// Params are appended to the key so interpolated values can be asserted.
vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

describe('QueueMonitorComponent: queue list, selection and refresh', () => {
    let $root: any;
    let component: any;
    let server: FakeServer;
    let ajax: any;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const create = (options: Record<string, unknown> = {}): any => {
        ajax = mockServer(server);
        component = createComponent($root, options);
        return component;
    };
    const rowNames = (): string[] => role('queues').find('.aaxis-queue-mon__queue-name').map((_: number, el: any) => el.textContent).get();
    const selectedNames = (): string[] => role('queues').find('.is-selected .aaxis-queue-mon__queue-name').map((_: number, el: any) => el.textContent).get();
    const toggle = (name: string): void => {
        role('queues').find(`.aaxis-queue-mon__queue-main[data-name="${name}"]`).trigger('click');
    };
    const requestsTo = (url: string): any[] => ajax.mock.calls.filter((c: any[]) => c[0].url === url).map((c: any[]) => c[0]);

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        server = {queues: [queue('alpha', 5, 2, 1), queue('beta'), queue('gamma', 0, 0, 3)], details: []};
        Modal.instances.length = 0;
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
    });

    describe('initial load', () => {
        it('lists the queues and selects the first one, fetching only its detail', () => {
            server.details = [detail('alpha'), detail('beta')];

            create();

            expect(requestsTo(URLS.queuesUrl)).toEqual([{url: '/queues', method: 'GET'}]);
            expect(requestsTo(URLS.queuesDetailUrl)).toEqual([
                {url: '/queues/detail', method: 'GET', traditional: false, data: {names: ['alpha']}}
            ]);
            expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
            expect(selectedNames()).toEqual(['alpha']);
            expect(role('detail').find('[data-role="chart"]')).toHaveLength(1);
        });

        it('shows the empty message and requests no detail when there are no queues', () => {
            server.queues = [];

            create();

            expect(role('queues').text()).toBe('aaxis.tools.queue_monitor.no_queues');
            expect(requestsTo(URLS.queuesDetailUrl)).toHaveLength(0);
            expect(role('placeholder')).toHaveLength(1);
        });

        it('tolerates a response without a queues array', () => {
            server.queues = undefined as any;

            create();

            expect(role('queues').text()).toBe('aaxis.tools.queue_monitor.no_queues');
        });

        it('shows the server error message in the list when loading fails', () => {
            server.queuesError = {responseJSON: {message: 'RabbitMQ down'}};

            create();

            expect(role('queues').find('.aaxis-queue-mon__empty').text()).toBe('RabbitMQ down');
        });

        it('falls back to a generic message when the failure carries no message', () => {
            server.queuesError = {};

            create();

            expect(role('queues').text()).toBe('aaxis.tools.queue_monitor.queues_error');
        });
    });

    describe('options', () => {
        it.each([
            ['the default when unset', undefined, 15000],
            ['the configured seconds', 5, 5000],
            ['the default for zero', 0, 15000],
            ['the default for a negative value', -3, 15000]
        ])('uses %s as the refresh interval', (_label, refreshInterval, expectedMs) => {
            create({refreshInterval});
            ajax.mockClear();

            vi.advanceTimersByTime(expectedMs - 1);
            expect(ajax).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(requestsTo(URLS.queuesUrl)).toHaveLength(1);
        });

        it('hides the message preview beyond previewMaxQueues (default 4)', () => {
            server.queues = ['a', 'b', 'c', 'd', 'e'].map(n => queue(n));
            create();

            role('select-all').trigger('click');

            expect(role('detail').find('[data-role="preview"]')).toHaveLength(0);
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith(
                'info', 'aaxis.tools.queue_monitor.preview_hidden_many {"max":4}');
        });

        it('honours a custom previewMaxQueues', () => {
            server.queues = ['a', 'b', 'c'].map(n => queue(n));
            create({previewMaxQueues: 2});

            role('select-all').trigger('click');

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith(
                'info', 'aaxis.tools.queue_monitor.preview_hidden_many {"max":2}');
        });

        it('caps maxMessageFetch at 1000 and defaults it to 100', () => {
            create();
            expect(role('detail').find('[data-role="preview-count"]').attr('max')).toBe('100');
            component.dispose();

            $root = $(MARKUP).appendTo(document.body);
            create({maxMessageFetch: 50000});
            expect(role('detail').find('[data-role="preview-count"]').attr('max')).toBe('1000');
        });

        it('limits the recent-samples table to historySamples rows', () => {
            const samples = [1, 2, 3, 4, 5, 6].map(i => ({timestamp: i * 1000, ready: i, unacked: 0, total: i}));
            server.details = [detail('alpha', samples)];

            create({historySamples: 3});

            expect(role('samples').find('tbody tr')).toHaveLength(3);
        });

        it('defaults historySamples to 15', () => {
            const samples = Array.from({length: 20}, (_, i) => ({timestamp: (i + 1) * 1000, ready: i, unacked: 0, total: i}));
            server.details = [detail('alpha', samples)];

            create();

            expect(role('samples').find('tbody tr')).toHaveLength(15);
        });
    });

    describe('queue rows', () => {
        it('renders the name, the ready/unacked/consumer badges and a 16-colour palette per queue', () => {
            create();

            const $row = role('queues').find('.aaxis-queue-mon__queue').first();
            const badges = $row.find('.aaxis-queue-mon__badge').map((_: number, el: any) => ({
                cls: el.className,
                value: $(el).find('.aaxis-queue-mon__badge-value').text()
            })).get();
            expect(badges).toEqual([
                {cls: 'aaxis-queue-mon__badge is-ready has-value', value: '5'},
                {cls: 'aaxis-queue-mon__badge is-unacked has-value', value: '2'},
                {cls: 'aaxis-queue-mon__badge is-consumers has-value', value: '1'}
            ]);
            expect(role('queues').find('.aaxis-queue-mon__queue').eq(1).find('.has-value')).toHaveLength(0);
            expect($row.find('[data-role="palette-color"]')).toHaveLength(16);
            expect($row.find('[data-role="palette"]').prop('hidden')).toBe(true);
            expect($row.find('.aaxis-queue-mon__check').hasClass('fa-check-square')).toBe(true);
            expect(role('queues').find('.aaxis-queue-mon__queue').eq(1).find('.aaxis-queue-mon__check')
                .hasClass('fa-square-o')).toBe(true);
        });

        it('assigns each queue a stable colour by its position', () => {
            create();

            const colors = role('queues').find('[data-role="color-swatch"]').map((_: number, el: any) => el.getAttribute('style')).get();
            expect(colors).toEqual(['background:#2b84ed', 'background:#e6492d', 'background:#27ae60']);
        });

        it('omits the selection checkbox when multi-select is disabled', () => {
            create({allowMultiselect: false});

            expect(role('queues').find('.aaxis-queue-mon__check')).toHaveLength(0);
        });

        it('shows a static colour dot instead of a palette when colour selection is disabled', () => {
            create({allowColorSelection: false});

            expect(role('queues').find('[data-role="color-swatch"]')).toHaveLength(0);
            expect(role('queues').find('[data-role="palette"]')).toHaveLength(0);
            expect(role('queues').find('.aaxis-queue-mon__swatch.is-static')).toHaveLength(3);
        });

        it('filters by name (case-insensitively), toggling the clear button', () => {
            create();

            role('filter').val('AL').trigger('input');

            expect(rowNames()).toEqual(['alpha']);
            expect(role('filter-clear').prop('hidden')).toBe(false);

            role('filter').val('zzz').trigger('input');
            expect(role('queues').text()).toBe('aaxis.tools.queue_monitor.no_queues');
        });

        it('clears the filter with its button and refocuses the input', () => {
            create();
            role('filter').val('alpha').trigger('input');
            const focused = vi.fn();
            role('filter')[0].addEventListener('focus', focused);
            const event = $.Event('click');

            role('filter-clear').trigger(event);

            expect(role('filter').val()).toBe('');
            expect(role('filter-clear').prop('hidden')).toBe(true);
            expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
            expect(event.isDefaultPrevented()).toBe(true);
            expect(focused).toHaveBeenCalled();
        });
    });

    describe('selection', () => {
        beforeEach(() => {
            server.details = [detail('alpha'), detail('beta'), detail('gamma')];
        });

        it('adds and removes queues from the selection in multi-select mode', () => {
            create();

            toggle('beta');
            expect(selectedNames()).toEqual(['alpha', 'beta']);
            expect(requestsTo(URLS.queuesDetailUrl).at(-1)!.data).toEqual({names: ['alpha', 'beta']});

            toggle('alpha');
            expect(selectedNames()).toEqual(['beta']);
            expect(component.details.alpha).toBeUndefined();
            expect(component.details.beta).toBeDefined();
        });

        it('toggles from the checkbox as well as from the name', () => {
            create();

            role('queues').find('.aaxis-queue-mon__check[data-name="gamma"]').trigger('click');

            expect(selectedNames()).toEqual(['alpha', 'gamma']);
        });

        it('replaces the selection in single-select mode', () => {
            create({allowMultiselect: false});

            toggle('gamma');

            expect(selectedNames()).toEqual(['gamma']);
            expect(requestsTo(URLS.queuesDetailUrl).at(-1)!.data).toEqual({names: ['gamma']});
            expect(Object.keys(component.details)).toEqual(['gamma']);
        });

        it('ignores a click on the only selected queue in single-select mode', () => {
            create({allowMultiselect: false});
            const before = requestsTo(URLS.queuesDetailUrl).length;

            toggle('alpha');

            expect(requestsTo(URLS.queuesDetailUrl)).toHaveLength(before);
            expect(selectedNames()).toEqual(['alpha']);
        });

        it('selects every queue with "select all", respecting the filter', () => {
            create();

            role('select-all').trigger('click');
            expect(selectedNames()).toEqual(['alpha', 'beta', 'gamma']);

            role('select-none').trigger('click');
            role('filter').val('ta').trigger('input');
            role('select-all').trigger('click');
            role('filter').val('').trigger('input');
            expect(selectedNames()).toEqual(['beta']);
        });

        it('clears everything with "select none" and shows the placeholder', () => {
            create();
            role('select-all').trigger('click');

            role('select-none').trigger('click');

            expect(selectedNames()).toEqual([]);
            expect(component.details).toEqual({});
            expect(role('detail').text()).toBe('aaxis.tools.queue_monitor.no_selection');
            expect(role('layout').hasClass('is-maximized')).toBe(false);
        });
    });

    describe('colour palette', () => {
        it('opens one palette at a time from the swatch and closes it on a second click', () => {
            create();
            const $palettes = role('queues').find('[data-role="palette"]');
            const swatch = (name: string): any => role('queues').find(`[data-role="color-swatch"][data-name="${name}"]`);

            swatch('beta').trigger('click');
            expect($palettes.filter('[data-name="beta"]').prop('hidden')).toBe(false);

            swatch('gamma').trigger('click');
            expect($palettes.filter('[data-name="beta"]').prop('hidden')).toBe(true);
            expect($palettes.filter('[data-name="gamma"]').prop('hidden')).toBe(false);

            swatch('gamma').trigger('click');
            expect($palettes.filter('[data-name="gamma"]').prop('hidden')).toBe(true);
        });

        it('finds the palette of a queue whose name contains quotes and backslashes', () => {
            const weird = 'we"ird\\name';
            server.queues = [queue(weird)];
            create();

            role('queues').find('[data-role="color-swatch"]').trigger('click');

            expect(role('queues').find('[data-role="palette"]').prop('hidden')).toBe(false);
        });

        it('closes an open palette on a mousedown elsewhere but not inside it', () => {
            create();
            role('queues').find('[data-role="color-swatch"]').first().trigger('click');
            const $palette = role('queues').find('[data-role="palette"]').first();

            $palette.find('[data-role="palette-color"]').first().trigger('mousedown');
            expect($palette.prop('hidden')).toBe(false);

            $(document.body).trigger('mousedown');
            expect($palette.prop('hidden')).toBe(true);
        });

        it('recolours a queue from its palette and closes the popover', () => {
            create();
            role('queues').find('[data-role="color-swatch"]').first().trigger('click');

            role('queues').find('[data-role="palette-color"][data-name="alpha"][data-color="#f39c12"]').trigger('click');

            expect(component.colors.alpha).toBe('#f39c12');
            expect(role('queues').find('[data-role="color-swatch"]').first().attr('style')).toBe('background:#f39c12');
            expect(role('queues').find('[data-role="palette"]:not([hidden])')).toHaveLength(0);
        });

        it('redraws the chart with the new colour when the recoloured queue is selected', () => {
            server.details = [detail('alpha', [{timestamp: 1000, ready: 1, unacked: 0, total: 1}, {timestamp: 2000, ready: 2, unacked: 0, total: 2}])];
            create();
            expect(role('chart').find('polyline').attr('stroke')).toBe('#2b84ed');

            role('queues').find('[data-role="palette-color"][data-name="alpha"][data-color="#795548"]').trigger('click');

            expect(role('chart').find('polyline').attr('stroke')).toBe('#795548');
        });

        it('does not redraw the chart when the recoloured queue is not selected', () => {
            create();
            const renderChart = vi.spyOn(component, 'renderChart');

            role('queues').find('[data-role="palette-color"][data-name="beta"][data-color="#795548"]').trigger('click');

            expect(renderChart).not.toHaveBeenCalled();
            expect(component.colors.beta).toBe('#795548');
        });
    });

    describe('auto refresh', () => {
        beforeEach(() => {
            server.details = [detail('alpha')];
        });

        it('reloads the queue list and the selected details on every tick', () => {
            create();
            ajax.mockClear();

            vi.advanceTimersByTime(15000);

            expect(requestsTo(URLS.queuesUrl)).toHaveLength(1);
            expect(requestsTo(URLS.queuesDetailUrl)).toHaveLength(1);
        });

        it('stops when the checkbox is unticked and restarts (once) when ticked again', () => {
            create();
            ajax.mockClear();

            role('autorefresh').prop('checked', false).trigger('change');
            vi.advanceTimersByTime(60000);
            expect(ajax).not.toHaveBeenCalled();

            role('autorefresh').prop('checked', true).trigger('change');
            role('autorefresh').prop('checked', true).trigger('change');
            vi.advanceTimersByTime(15000);
            expect(requestsTo(URLS.queuesUrl)).toHaveLength(1);
        });

        it('keeps a failing background refresh silent', () => {
            create();
            server.queuesError = {responseJSON: {message: 'boom'}};
            server.detailError = true;

            vi.advanceTimersByTime(15000);

            expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
            expect(role('detail').find('.alert')).toHaveLength(0);
        });

        it('refreshes immediately from the refresh button, surfacing errors', () => {
            create();
            ajax.mockClear();
            server.queuesError = {responseJSON: {message: 'nope'}};
            const event = $.Event('click');

            role('refresh').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(requestsTo(URLS.queuesUrl)).toHaveLength(1);
            expect(role('queues').text()).toBe('nope');
        });
    });

    describe('detail loading', () => {
        it('shows an error alert when the detail request fails', () => {
            server.detailError = true;

            create();

            expect(role('detail').find('.alert.alert-error').text()).toBe('aaxis.tools.queue_monitor.queue_error');
        });

        it('drops details for queues that are no longer selected and ignores nameless entries', () => {
            server.details = [detail('alpha')];
            server.rawDetails = [detail('alpha'), {samples: []}, null];
            create();
            component.details.stale = detail('stale');

            component.loadDetails(false);

            expect(Object.keys(component.details)).toEqual(['alpha']);
        });

        it('tolerates a detail response without a queues array', () => {
            create();
            server.rawDetails = undefined;
            ajax.mockImplementation(() => $.Deferred().resolve({}).promise());

            expect(() => component.loadDetails(false)).not.toThrow();
            expect(component.details).toEqual({});
        });

        it('does not call the server when nothing is selected', () => {
            create();
            role('select-none').trigger('click');
            ajax.mockClear();

            component.loadDetails(false);

            expect(ajax).not.toHaveBeenCalled();
        });

        it('explains that metrics are disabled when RabbitMQ reports no samples for the selection', () => {
            server.details = [detail('alpha', [], {samplesAvailable: false})];

            create();

            expect(role('chart').text()).toBe('aaxis.tools.queue_monitor.samples_disabled');
            expect(role('samples').text()).toBe('aaxis.tools.queue_monitor.samples_disabled');
        });

        it('says there is no history yet when samples are merely empty', () => {
            server.details = [detail('alpha', [])];

            create();

            expect(role('chart').text()).toBe('aaxis.tools.queue_monitor.no_history');
        });
    });

    describe('detail structure', () => {
        it('renders the history section and the samples/messages columns for a small selection', () => {
            server.details = [detail('alpha'), detail('beta')];
            create();
            toggle('beta');

            expect(role('detail').find('.aaxis-queue-mon__history-section h3').text())
                .toBe('aaxis.tools.queue_monitor.history_title');
            const $select = role('detail').find('[data-role="preview-queue"]');
            expect($select.find('option').map((_: number, o: any) => o.value).get()).toEqual(['alpha', 'beta']);
            const $count = role('detail').find('[data-role="preview-count"]');
            expect($count.attr('min')).toBe('1');
            expect($count.attr('max')).toBe('100');
            expect($count.val()).toBe('10');
            expect($count.attr('title')).toBe('aaxis.tools.queue_monitor.preview_count_title {"max":100}');
            expect(role('detail').find('[data-role="preview"]').text()).toBe('aaxis.tools.queue_monitor.preview_btn');
            expect(role('detail').find('[data-role="messages"]')).toHaveLength(1);
        });

        it('lowers the default preview count when maxMessageFetch is below 10', () => {
            create({maxMessageFetch: 5});

            expect(role('detail').find('[data-role="preview-count"]').val()).toBe('5');
        });

        it('has no preview column when the preview is disabled by configuration, and no notification', () => {
            create({allowMessagePreview: false});
            role('select-all').trigger('click');

            expect(role('detail').find('[data-role="preview"]')).toHaveLength(0);
            expect(role('detail').find('[data-role="samples"]')).toHaveLength(1);
            expect(messenger.notificationFlashMessage).not.toHaveBeenCalled();
        });

        it('announces the hidden preview once, and again only after it was visible in between', () => {
            server.queues = ['a', 'b', 'c', 'd', 'e'].map(n => queue(n));
            create({previewMaxQueues: 2});
            const flash = messenger.notificationFlashMessage as any;

            toggle('b');
            expect(flash).not.toHaveBeenCalled();
            toggle('c');
            expect(flash).toHaveBeenCalledTimes(1);
            toggle('d');
            expect(flash).toHaveBeenCalledTimes(1);

            toggle('d');
            toggle('c');
            expect(role('detail').find('[data-role="preview"]')).toHaveLength(1);
            toggle('c');
            expect(flash).toHaveBeenCalledTimes(2);
        });

        it('maximizes and restores the chart area, updating the button title and icon', () => {
            server.details = [detail('alpha')];
            create();
            const raf = vi.spyOn(component, 'renderChart');
            const event = $.Event('click');

            role('detail').find('[data-role="maximize"]').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(role('layout').hasClass('is-maximized')).toBe(true);
            expect(role('maximize').attr('title')).toBe('aaxis.tools.queue_monitor.minimize');
            expect(role('maximize').find('.fa').attr('class')).toBe('fa fa-compress');
            expect(raf).not.toHaveBeenCalled();
            vi.advanceTimersByTime(20);
            expect(raf).toHaveBeenCalledTimes(1);

            role('maximize').trigger('click');
            expect(role('layout').hasClass('is-maximized')).toBe(false);
            expect(role('maximize').attr('title')).toBe('aaxis.tools.queue_monitor.maximize');
            expect(role('maximize').find('.fa').attr('class')).toBe('fa fa-expand');
        });

        it('keeps the maximized state when the structure is rebuilt, and resets it with no selection', () => {
            create();
            role('maximize').trigger('click');
            expect(role('maximize').find('.fa').attr('class')).toBe('fa fa-compress');

            toggle('beta');
            expect(role('layout').hasClass('is-maximized')).toBe(true);
            expect(role('maximize').attr('title')).toBe('aaxis.tools.queue_monitor.minimize');

            role('select-none').trigger('click');
            expect(role('layout').hasClass('is-maximized')).toBe(false);
            toggle('alpha');
            expect(role('maximize').find('.fa').attr('class')).toBe('fa fa-expand');
        });
    });

    describe('help and dispose', () => {
        it('opens the help in a close-only modal', () => {
            create();
            const event = $.Event('click');

            role('help').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(Modal.instances).toHaveLength(1);
            expect(Modal.instances[0].options).toMatchObject({
                title: 'aaxis.tools.queue_monitor.help', allowOk: false, cancelText: 'Close'
            });
            expect(Modal.instances[0].options.content).toContain('Queue help');
            expect(Modal.instances[0].open).toHaveBeenCalled();
        });

        it('stops the timer and unbinds every handler on dispose, and is idempotent', () => {
            create();
            ajax.mockClear();

            component.dispose();
            component.dispose();
            vi.advanceTimersByTime(60000);
            role('select-all').trigger('click');
            $(window).trigger('resize');

            expect(ajax).not.toHaveBeenCalled();
            expect(component.disposed).toBe(true);
        });

        it('cancels a pending resize frame on dispose', () => {
            create();
            const renderChart = vi.spyOn(component, 'renderChart');
            $(window).trigger('resize');

            component.dispose();
            vi.advanceTimersByTime(50);

            expect(renderChart).not.toHaveBeenCalled();
        });
    });
});
