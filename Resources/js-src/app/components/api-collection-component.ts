import $ from 'jquery';
import __ from 'orotranslation/js/translator';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import BaseComponent from 'oroui/js/app/components/base/component';
import CodeMirror from 'codemirror';
import 'codemirror/addon/runmode/runmode';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/xml/xml';
import 'codemirror/mode/htmlmixed/htmlmixed';

interface ApiCollectionOptions {
    _sourceElement: any;
    treeUrl: string;
    createUrl: string;
    runUrl: string;
    executeUrl: string;
}

interface KvPair { key: string; value: string; }

interface ApiNode {
    id: number;
    type: 'folder' | 'request';
    name: string;
    parentId: number | null;
    public: boolean;
    owned: boolean;
    method: string | null;
    url: string | null;
    params: KvPair[];
    headers: KvPair[];
    bodyType: string;
    body: string;
}

interface RequestData {
    method: string;
    url: string;
    params: KvPair[];
    headers: KvPair[];
    bodyType: string;
    body: string;
}

interface RunRecord {
    id: number;
    name?: string | null;
    method: string;
    url: string;
    status: number | null;
    result: string;
    sizeBytes: number | null;
    timeMs: number | null;
    runAt: string | null;
}

interface LastResponse {
    status: number;
    statusText: string;
    headers: KvPair[];
    body: string;
    contentType: string;
    timeMs: number;
    size: number;
}

const METHOD_CLASS: Record<string, string> = {
    GET: 'is-get', POST: 'is-post', PUT: 'is-put', PATCH: 'is-patch',
    DELETE: 'is-delete', OPTIONS: 'is-options', HEAD: 'is-head'
};

class ApiCollectionComponent extends BaseComponent {
    private $el!: any;
    private urls!: {tree: string; create: string; run: string; execute: string};
    private nodes!: ApiNode[];
    private runs!: RunRecord[];
    private currentUserId!: number | null;
    private activeId!: number | null;
    private activeTab!: string;
    private filterText!: string;
    private expanded!: Record<number, boolean>;
    private running!: boolean;
    private $menu!: any;
    private bodyEditor!: any;
    private dirty!: boolean;
    private snapshot!: RequestData | null;
    private lastResponse!: LastResponse | null;
    private resultTab!: string;
    private loadingRequest!: boolean;

    initialize(options: ApiCollectionOptions): void {
        this.$el = options._sourceElement;
        this.urls = {tree: options.treeUrl, create: options.createUrl, run: options.runUrl, execute: options.executeUrl};
        this.nodes = [];
        this.runs = [];
        this.currentUserId = null;
        this.activeId = null;
        this.activeTab = 'params';
        this.filterText = '';
        this.expanded = {};
        this.running = false;
        this.$menu = null;
        this.bodyEditor = null;
        this.dirty = false;
        this.snapshot = null;
        this.lastResponse = null;
        this.resultTab = 'body';
        this.loadingRequest = false;

        this.bindEvents();
        this.initBodyEditor();
        this.loadTree();
    }

    private bindEvents(): void {
        this.$el.on('click.aaxisApi', '[data-role="help"]', this.onHelp.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="add-root-folder"]', () => this.addFolder(null));
        this.$el.on('input.aaxisApi', '[data-role="filter"]', (e: any) => {
            this.filterText = String(e.currentTarget.value || '').toLowerCase();
            this.renderTree();
        });
        this.$el.on('click.aaxisApi', '[data-role="node-label"]', this.onNodeLabel.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="node-menu"]', this.onNodeMenu.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="node-lock"]', this.onLockToggle.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="node-save"]', this.onNodeSave.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="tab"]', this.onTab.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="res-tab"]', this.onResTab.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="add-param"]', () => { this.addKvRow('params'); this.markDirty(); });
        this.$el.on('click.aaxisApi', '[data-role="add-header"]', () => { this.addKvRow('headers'); this.markDirty(); });
        this.$el.on('click.aaxisApi', '[data-role="kv-del"]', (e: any) => {
            $(e.currentTarget).closest('.aaxis-api__kv-row').remove();
            this.markDirty();
        });
        this.$el.on('click.aaxisApi', '[data-role="beautify"]', this.onBeautify.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="send"]', this.onSend.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="max-request"]', this.onMaxRequest.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="max-response"]', this.onMaxResponse.bind(this));
        this.$el.on('click.aaxisApi', '[data-role="rightbar-toggle"]', this.onToggleRightbar.bind(this));

        // Dirty tracking for the active request.
        this.$el.on('input.aaxisApi change.aaxisApi',
            '[data-role="url"], [data-role="body-type"], '
            + '[data-role="params-rows"] input, [data-role="headers-rows"] input',
            () => this.markDirty());
        this.$el.on('change.aaxisApi', '[data-role="method"]', this.onMethodChange.bind(this));
        this.$el.on('change.aaxisApi', '[data-role="body-type"]', () => this.onBodyTypeChange());

        $(window).on('resize.aaxisApi', () => {
            if (this.activeTab === 'body') {
                this.fitBodyEditor();
            }
        });
    }

    // --- Backend helpers -----------------------------------------------------

    private csrf(): string {
        const name = window.location.protocol === 'https:' ? 'https-_csrf' : '_csrf';
        const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : '';
    }

    private apiFetch(url: string, method: string, body?: any): Promise<any> {
        const opts: any = {
            method, credentials: 'same-origin',
            headers: {'Content-Type': 'application/json', 'X-CSRF-Header': this.csrf()}
        };
        if (body !== undefined) {
            opts.body = JSON.stringify(body);
        }
        return fetch(url, opts).then(r => r.json().then(d => ({ok: r.ok, data: d})));
    }

    private nodeUrl(id: number): string {
        return this.urls.create + '/' + id;
    }

    private duplicateUrl(id: number): string {
        return this.urls.create + '/' + id + '/duplicate';
    }

    private setBusy(busy: boolean): void {
        this.$el.find('[data-role="sidebar"]').toggleClass('is-busy', busy);
        this.$el.find('[data-role="busy"]').prop('hidden', !busy);
    }

    private loadTree(): Promise<void> {
        return fetch(this.urls.tree, {credentials: 'same-origin'})
            .then(r => r.json())
            .then((data: {nodes: ApiNode[]; runs: RunRecord[]; currentUserId: number | null}) => {
                this.nodes = data.nodes || [];
                this.runs = data.runs || [];
                this.currentUserId = data.currentUserId ?? null;
                this.nodes.forEach(n => {
                    if (n.type === 'folder' && this.expanded[n.id] === undefined) {
                        this.expanded[n.id] = true;
                    }
                });
                this.renderTree();
                this.renderRuns();
            })
            .catch(() => messenger.notificationFlashMessage('error', __('aaxis.tools.api_collection.tree_error')));
    }

    private findNode(id: number | null): ApiNode | undefined {
        return this.nodes.find(n => n.id === id);
    }

    // --- Tree rendering ------------------------------------------------------

    private childrenOf(parentId: number | null): ApiNode[] {
        return this.nodes
            .filter(n => n.parentId === parentId)
            .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'folder' ? -1 : 1)));
    }

    private matchIds(): Set<number> | null {
        if (this.filterText === '') {
            return null;
        }
        const keep = new Set<number>();
        this.nodes.forEach(n => {
            if (n.name.toLowerCase().indexOf(this.filterText) !== -1) {
                let cur: ApiNode | undefined = n;
                while (cur) {
                    keep.add(cur.id);
                    cur = this.findNode(cur.parentId);
                }
            }
        });
        return keep;
    }

    private renderTree(): void {
        const $tree = this.$el.find('[data-role="tree"]').empty();
        const keep = this.matchIds();
        this.childrenOf(null).forEach(node => {
            const $li = this.renderNode(node, keep);
            if ($li) {
                $tree.append($li);
            }
        });
        this.updateMainEnabled();
    }

    // Disable the request editor (right side) while no request is being viewed/edited.
    private updateMainEnabled(): void {
        const active = this.activeId !== null && !!this.findNode(this.activeId);
        this.$el.find('[data-role="main"]').toggleClass('is-disabled', !active);
        if (this.bodyEditor) {
            this.bodyEditor.setOption('readOnly', active ? false : 'nocursor');
        }
    }

    private renderNode(node: ApiNode, keep: Set<number> | null): any {
        if (keep && !keep.has(node.id)) {
            return null;
        }
        const isActive = node.id === this.activeId;
        const isDirty = isActive && this.dirty;
        const $li = $('<li/>', {'class': 'aaxis-api__node'});
        const $label = $('<div/>', {
            'class': 'aaxis-api__node-label' + (isActive ? ' is-active' : '') + (isDirty ? ' is-dirty' : ''),
            'data-role': 'node-label', 'data-id': node.id, 'data-type': node.type
        });

        if (node.type === 'folder') {
            const expanded = keep ? true : !!this.expanded[node.id];
            $label.append($('<span/>', {
                'class': 'fa ' + (expanded ? 'fa-folder-open' : 'fa-folder') + ' aaxis-api__node-icon',
                'aria-hidden': 'true'
            }));
        } else {
            const method = node.method || 'GET';
            $label.append($('<span/>', {'class': 'aaxis-api__method-badge ' + (METHOD_CLASS[method] || ''), text: method}));
            $label.append($('<span/>', {
                'class': 'fa ' + (node.public ? 'fa-unlock-alt' : 'fa-lock') + ' aaxis-api__node-lock'
                    + (node.public ? ' is-public' : ''),
                'data-role': 'node-lock', 'data-id': node.id,
                title: node.public ? __('aaxis.tools.api_collection.public') : __('aaxis.tools.api_collection.private'),
                'aria-hidden': 'true'
            }));
        }
        $label.append($('<span/>', {'class': 'aaxis-api__node-name', text: node.name}));

        if (isDirty && node.owned) {
            $label.append($('<button/>', {
                type: 'button', 'class': 'aaxis-api__node-save', 'data-role': 'node-save', 'data-id': node.id,
                title: __('aaxis.tools.api_collection.save'), 'aria-label': __('aaxis.tools.api_collection.save')
            }).append($('<span/>', {'class': 'fa fa-floppy-o', 'aria-hidden': 'true'})));
        }

        $label.append($('<button/>', {
            type: 'button', 'class': 'aaxis-api__node-actions', 'data-role': 'node-menu', 'data-id': node.id,
            title: __('aaxis.tools.api_collection.actions'), html: '&#8942;'
        }));
        $li.append($label);

        if (node.type === 'folder') {
            const expanded = keep ? true : !!this.expanded[node.id];
            if (expanded) {
                const $ul = $('<ul/>', {'class': 'aaxis-api__tree'});
                this.childrenOf(node.id).forEach(child => {
                    const $childLi = this.renderNode(child, keep);
                    if ($childLi) {
                        $ul.append($childLi);
                    }
                });
                $li.append($ul);
            }
        }
        return $li;
    }

    private onNodeLabel(event: any): void {
        if ($(event.target).closest('[data-role="node-menu"], [data-role="node-lock"], [data-role="node-save"]').length) {
            return;
        }
        const id = Number($(event.currentTarget).data('id'));
        const node = this.findNode(id);
        if (!node) {
            return;
        }
        if (node.type === 'folder') {
            this.expanded[id] = !this.expanded[id];
            this.renderTree();
            return;
        }
        this.switchToRequest(node);
    }

    private switchToRequest(node: ApiNode): void {
        if (this.activeId !== null && this.activeId !== node.id && this.dirty) {
            // auto-persist edits before leaving (avoids data loss)
            this.saveActive(true);
        }
        this.activeId = node.id;
        this.dirty = false;
        this.clearResponse();
        this.loadRequest(node);
        this.renderTree();
    }

    /** Drops the previously displayed response so it does not bleed into another request. */
    private clearResponse(): void {
        this.lastResponse = null;
        this.resultTab = 'body';
        this.$el.find('[data-role="result"]').empty().append(
            $('<div/>', {'class': 'aaxis-api__result-empty', text: __('aaxis.tools.api_collection.no_response')})
        );
    }

    // --- Node context menu ---------------------------------------------------

    private onNodeMenu(event: any): void {
        event.preventDefault();
        event.stopPropagation();
        const id = Number($(event.currentTarget).data('id'));
        const node = this.findNode(id);
        if (!node) {
            return;
        }
        const items: Array<{action: string; label: string}> = [];
        if (node.type === 'folder') {
            items.push({action: 'add-folder', label: __('aaxis.tools.api_collection.menu_add_folder')});
            items.push({action: 'add-request', label: __('aaxis.tools.api_collection.menu_add_request')});
            items.push({action: 'import-curl', label: __('aaxis.tools.api_collection.menu_import_curl')});
        } else {
            items.push({action: 'export-curl', label: __('aaxis.tools.api_collection.menu_export_curl')});
            items.push({action: 'duplicate', label: __('aaxis.tools.api_collection.menu_duplicate')});
            if (id === this.activeId && this.dirty) {
                items.push({action: 'discard', label: __('aaxis.tools.api_collection.menu_discard')});
            }
        }
        items.push({action: 'rename', label: __('aaxis.tools.api_collection.menu_rename')});
        items.push({action: 'remove', label: __('aaxis.tools.api_collection.menu_remove')});
        this.openMenu(event.currentTarget, id, items);
    }

    private openMenu(anchor: any, id: number, items: Array<{action: string; label: string}>): void {
        this.closeMenu();
        const $menu = $('<ul/>', {'class': 'aaxis-api__menu', role: 'menu'});
        items.forEach(item => {
            $menu.append($('<li/>').append($('<a/>', {
                href: '#', role: 'menuitem', 'data-action': item.action, text: item.label
            })));
        });
        const rect = anchor.getBoundingClientRect();
        $menu.css({top: (rect.bottom + window.scrollY) + 'px', left: (rect.left + window.scrollX) + 'px'});
        $menu.on('click', 'a', (e: any) => {
            e.preventDefault();
            this.onMenuAction(String($(e.currentTarget).data('action')), id);
            this.closeMenu();
        });
        $('body').append($menu);
        this.$menu = $menu;
        setTimeout(() => {
            $(document).on('mousedown.aaxisApiMenu', (e: any) => {
                if (!$(e.target).closest('.aaxis-api__menu').length) {
                    this.closeMenu();
                }
            });
        }, 0);
    }

    private closeMenu(): void {
        if (this.$menu) {
            this.$menu.remove();
            this.$menu = null;
        }
        $(document).off('.aaxisApiMenu');
    }

    private onMenuAction(action: string, id: number): void {
        const node = this.findNode(id);
        if (!node) {
            return;
        }
        switch (action) {
            case 'add-folder': this.addFolder(id); break;
            case 'add-request': this.addRequest(id); break;
            case 'import-curl': this.importCurl(id); break;
            case 'export-curl': this.exportCurl(node); break;
            case 'duplicate': this.duplicate(id); break;
            case 'discard': this.discard(); break;
            case 'rename': this.rename(node); break;
            case 'remove': this.remove(node); break;
        }
    }

    // --- Node operations -----------------------------------------------------

    private addFolder(parentId: number | null): void {
        const name = (window.prompt(__('aaxis.tools.api_collection.prompt_folder')) || '').trim();
        if (name === '') {
            return;
        }
        if (parentId !== null) {
            this.expanded[parentId] = true;
        }
        this.setBusy(true);
        this.apiFetch(this.urls.create, 'POST', {type: 'folder', name, parentId})
            .then(() => this.loadTree())
            .finally(() => this.setBusy(false));
    }

    private addRequest(parentId: number | null): void {
        const name = (window.prompt(__('aaxis.tools.api_collection.prompt_request')) || '').trim();
        if (name === '') {
            return;
        }
        if (parentId !== null) {
            this.expanded[parentId] = true;
        }
        this.setBusy(true);
        let created: any = null;
        this.apiFetch(this.urls.create, 'POST', {type: 'request', name, parentId, method: 'GET', url: '', bodyType: 'none'})
            .then((res: any) => {
                created = res.data && res.data.node ? res.data.node : null;
                return this.loadTree();
            })
            .then(() => {
                if (created) {
                    const node = this.findNode(created.id);
                    if (node) {
                        this.switchToRequest(node);
                    }
                }
            })
            .finally(() => this.setBusy(false));
    }

    private rename(node: ApiNode): void {
        const name = (window.prompt(__('aaxis.tools.api_collection.prompt_rename'), node.name) || '').trim();
        if (name === '' || name === node.name) {
            return;
        }
        this.setBusy(true);
        this.apiFetch(this.nodeUrl(node.id), 'PUT', {name})
            .then(() => this.loadTree())
            .finally(() => this.setBusy(false));
    }

    private remove(node: ApiNode): void {
        if (!window.confirm(__('aaxis.tools.api_collection.confirm_remove', {name: node.name}))) {
            return;
        }
        this.setBusy(true);
        fetch(this.nodeUrl(node.id), {method: 'DELETE', credentials: 'same-origin', headers: {'X-CSRF-Header': this.csrf()}})
            .then(r => r.json())
            .then((data: any) => {
                if (!data.success) {
                    messenger.notificationFlashMessage('error', data.message || __('aaxis.tools.api_collection.error'));
                    return;
                }
                if (this.activeId === node.id) {
                    this.activeId = null;
                    this.dirty = false;
                }
                return this.loadTree();
            })
            .finally(() => this.setBusy(false));
    }

    private duplicate(id: number): void {
        this.setBusy(true);
        this.apiFetch(this.duplicateUrl(id), 'POST')
            .then(() => this.loadTree())
            .finally(() => this.setBusy(false));
    }

    private onLockToggle(event: any): void {
        event.preventDefault();
        event.stopPropagation();
        const id = Number($(event.currentTarget).data('id'));
        const node = this.findNode(id);
        if (!node) {
            return;
        }
        if (!node.owned) {
            messenger.notificationFlashMessage('warning', __('aaxis.tools.api_collection.not_owner'));
            return;
        }
        this.setBusy(true);
        this.apiFetch(this.nodeUrl(id), 'PUT', {public: !node.public})
            .then(() => this.loadTree())
            .finally(() => this.setBusy(false));
    }

    private onNodeSave(event: any): void {
        event.preventDefault();
        event.stopPropagation();
        this.saveActive(false);
    }

    // --- Request editor ------------------------------------------------------

    private initBodyEditor(): void {
        const textarea = this.$el.find('[data-role="body"]').get(0);
        if (!textarea) {
            return;
        }
        this.bodyEditor = CodeMirror.fromTextArea(textarea, {
            lineNumbers: true,
            lineWrapping: true,
            mode: null
        });
        this.bodyEditor.setSize('100%', '160px');
        this.bodyEditor.on('change', () => this.markDirty());
    }

    private cmModeFor(type: string): any {
        if (type === 'json') {
            return {name: 'javascript', json: true};
        }
        if (type === 'xml') {
            return 'xml';
        }
        return null;
    }

    private onBodyTypeChange(): void {
        const type = String(this.$el.find('[data-role="body-type"]').val() || 'none');
        if (this.bodyEditor) {
            this.bodyEditor.setOption('mode', this.cmModeFor(type));
        }
        this.$el.find('[data-role="beautify"]').prop('hidden', type !== 'json' && type !== 'xml');
    }

    // Reflect the selected method on the tree node icon (badge) immediately.
    private onMethodChange(): void {
        if (this.loadingRequest) {
            return;
        }
        const node = this.findNode(this.activeId);
        if (node && node.type === 'request' && node.owned) {
            node.method = String(this.$el.find('[data-role="method"]').val() || 'GET');
        }
        this.markDirty();
        this.renderTree();
    }

    // --- Maximize request / response areas -----------------------------------

    private onMaxRequest(): void {
        const $main = this.$el.find('[data-role="main"]');
        const on = !$main.hasClass('is-req-max');
        $main.toggleClass('is-req-max', on).removeClass('is-res-max');
        this.updateMaxIcons();
        // Let the new layout settle before measuring, then resize the body editor to fill it.
        window.setTimeout(() => this.fitBodyEditor(), 0);
    }

    private onMaxResponse(): void {
        const $main = this.$el.find('[data-role="main"]');
        const on = !$main.hasClass('is-res-max');
        $main.toggleClass('is-res-max', on).removeClass('is-req-max');
        this.updateMaxIcons();
        window.setTimeout(() => this.fitBodyEditor(), 0);
    }

    // Resize the CodeMirror body editor: fill the panel when maximized, fixed height otherwise.
    private fitBodyEditor(): void {
        if (!this.bodyEditor) {
            return;
        }
        const reqMax = this.$el.find('[data-role="main"]').hasClass('is-req-max');
        if (!reqMax) {
            this.bodyEditor.setSize('100%', '160px');
            this.bodyEditor.refresh();
            return;
        }
        const panelsH = this.$el.find('.aaxis-api__panels').height() || 0;
        const barH = this.$el.find('.aaxis-api__body-bar').outerHeight(true) || 0;
        const height = Math.max(panelsH - barH - 16, 200);
        this.bodyEditor.setSize('100%', height + 'px');
        this.bodyEditor.refresh();
    }

    private updateMaxIcons(): void {
        const $main = this.$el.find('[data-role="main"]');
        const reqMax = $main.hasClass('is-req-max');
        const resMax = $main.hasClass('is-res-max');
        $main.find('[data-role="max-request"] .fa').attr('class', 'fa ' + (reqMax ? 'fa-compress' : 'fa-expand'));
        $main.find('[data-role="max-response"] .fa').attr('class', 'fa ' + (resMax ? 'fa-compress' : 'fa-expand'));
    }

    private loadRequest(node: ApiNode): void {
        this.loadingRequest = true;
        // Set value and trigger change so enhanced (select2) widgets update their rendered label.
        this.$el.find('[data-role="method"]').val(node.method || 'GET').trigger('change');
        this.$el.find('[data-role="url"]').val(node.url || '');
        this.$el.find('[data-role="body-type"]').val(node.bodyType || 'none').trigger('change');
        if (this.bodyEditor) {
            this.bodyEditor.setValue(node.body || '');
            this.bodyEditor.setOption('mode', this.cmModeFor(node.bodyType || 'none'));
        }
        this.renderKvRows('params', node.params || []);
        this.renderKvRows('headers', node.headers || []);
        this.onBodyTypeChange();
        this.snapshot = this.collectRequest();
        this.loadingRequest = false;
    }

    private collectRequest(): RequestData {
        return {
            method: String(this.$el.find('[data-role="method"]').val() || 'GET'),
            url: String(this.$el.find('[data-role="url"]').val() || '').trim(),
            params: this.readKv('params'),
            headers: this.readKv('headers'),
            bodyType: String(this.$el.find('[data-role="body-type"]').val() || 'none'),
            body: this.bodyEditor ? String(this.bodyEditor.getValue()) : String(this.$el.find('[data-role="body"]').val() || '')
        };
    }

    private markDirty(): void {
        if (this.loadingRequest) {
            return;
        }
        const node = this.findNode(this.activeId);
        if (!node || node.type !== 'request' || !node.owned || this.dirty) {
            return;
        }
        this.dirty = true;
        this.renderTree();
    }

    private saveActive(silent: boolean): void {
        const node = this.findNode(this.activeId);
        if (!node || node.type !== 'request' || !node.owned) {
            return;
        }
        const req = this.collectRequest();
        Object.assign(node, req);
        this.snapshot = req;
        this.dirty = false;
        if (!silent) {
            this.renderTree();
        }
        this.apiFetch(this.nodeUrl(node.id), 'PUT', req).then(() => {
            if (!silent) {
                messenger.notificationFlashMessage('success', __('aaxis.tools.api_collection.saved'));
            }
        });
    }

    private discard(): void {
        if (!this.snapshot) {
            return;
        }
        const node = this.findNode(this.activeId);
        if (node) {
            Object.assign(node, this.snapshot);
            this.loadRequest(node);
        }
        this.dirty = false;
        this.renderTree();
    }

    private renderKvRows(which: string, rows: KvPair[]): void {
        const $c = this.$el.find('[data-role="' + which + '-rows"]').empty();
        (rows || []).forEach(r => $c.append(this.kvRow(r.key, r.value)));
        $c.append(this.kvRow('', ''));
    }

    private addKvRow(which: string): void {
        this.$el.find('[data-role="' + which + '-rows"]').append(this.kvRow('', ''));
    }

    private kvRow(key: string, value: string): any {
        return $('<div/>', {'class': 'aaxis-api__kv-row'}).append(
            $('<input/>', {type: 'text', 'class': 'form-control aaxis-api__kv-key', placeholder: __('aaxis.tools.api_collection.key'), value: key, spellcheck: false}),
            $('<input/>', {type: 'text', 'class': 'form-control aaxis-api__kv-value', placeholder: __('aaxis.tools.api_collection.value'), value: value, spellcheck: false}),
            $('<button/>', {type: 'button', 'class': 'aaxis-api__kv-del', 'data-role': 'kv-del', title: __('aaxis.tools.api_collection.menu_remove'), html: '&times;'})
        );
    }

    private readKv(which: string): KvPair[] {
        const result: KvPair[] = [];
        this.$el.find('[data-role="' + which + '-rows"] .aaxis-api__kv-row').each((_: number, el: any) => {
            const $row = $(el);
            const key = String($row.find('.aaxis-api__kv-key').val() || '').trim();
            if (key !== '') {
                result.push({key, value: String($row.find('.aaxis-api__kv-value').val() || '')});
            }
        });
        return result;
    }

    private onTab(event: any): void {
        const tab = String($(event.currentTarget).data('tab'));
        this.activeTab = tab;
        this.$el.find('[data-role="tab"]').removeClass('is-active');
        $(event.currentTarget).addClass('is-active');
        this.$el.find('[data-role="panel"]').each((_: number, el: any) => $(el).prop('hidden', String($(el).data('tab')) !== tab));
        if (tab === 'body' && this.bodyEditor) {
            this.fitBodyEditor();
        }
    }

    private onBeautify(): void {
        if (!this.bodyEditor) {
            return;
        }
        const type = String(this.$el.find('[data-role="body-type"]').val() || 'none');
        const value = String(this.bodyEditor.getValue());
        try {
            if (type === 'json') {
                this.bodyEditor.setValue(JSON.stringify(JSON.parse(value), null, 2));
            } else if (type === 'xml') {
                this.bodyEditor.setValue(this.formatXml(value));
            }
        } catch (e) {
            messenger.notificationFlashMessage('warning', __('aaxis.tools.api_collection.beautify_error'));
        }
    }

    private formatXml(xml: string): string {
        const reg = /(>)(<)(\/*)/g;
        const xmlStr = xml.replace(/\r?\n/g, '').replace(/>\s+</g, '><').replace(reg, '$1\n$2$3');
        let pad = 0;
        return xmlStr.split('\n').map(line => {
            let indent = 0;
            if (/^<\/\w/.test(line)) {
                pad = Math.max(pad - 1, 0);
            } else if (/^<\w[^>]*[^/]>$/.test(line) && !/^<.*<\/.*>$/.test(line)) {
                indent = 1;
            }
            const out = '  '.repeat(pad) + line;
            pad += indent;
            return out;
        }).join('\n');
    }

    // --- Send (server-side proxy, avoids browser CORS) -----------------------

    private onSend(): void {
        if (this.running) {
            return;
        }
        const req = this.collectRequest();
        if (req.url === '') {
            messenger.notificationFlashMessage('warning', __('aaxis.tools.api_collection.url_required'));
            return;
        }
        if (this.dirty) {
            this.saveActive(true);
        }
        this.setRunning(true);
        this.$el.find('[data-role="result"]').html('').append(
            $('<div/>', {'class': 'aaxis-api__result-empty', text: __('aaxis.tools.api_collection.sending')})
        );

        const node = this.findNode(this.activeId);
        this.apiFetch(this.urls.execute, 'POST', {
            requestId: this.activeId,
            name: node ? node.name : null,
            method: req.method,
            url: req.url,
            params: req.params,
            headers: req.headers,
            bodyType: req.bodyType,
            body: req.body
        }).then((res: any) => {
            const data = res.data || {};
            if (data.runs) {
                this.runs = data.runs;
                this.renderRuns();
            }
            const resp = data.response || {};
            if (resp.success) {
                this.lastResponse = {
                    status: resp.status,
                    statusText: resp.statusText || '',
                    headers: resp.headers || [],
                    body: resp.body || '',
                    contentType: resp.contentType || '',
                    timeMs: resp.timeMs || 0,
                    size: resp.size || 0
                };
                this.resultTab = 'body';
                this.renderResult();
            } else {
                this.lastResponse = null;
                this.renderError(__('aaxis.tools.api_collection.fetch_error') + ' ' + (resp.error || ''));
            }
        }).catch(() => {
            this.lastResponse = null;
            this.renderError(__('aaxis.tools.api_collection.error'));
        }).finally(() => this.setRunning(false));
    }

    private renderError(message: string): void {
        this.$el.find('[data-role="result"]').empty().append(
            $('<div/>', {'class': 'alert alert-error', role: 'alert'}).text(message)
        );
    }

    // --- Response (with sub-tabs) --------------------------------------------

    private renderResult(): void {
        const res = this.lastResponse;
        const $result = this.$el.find('[data-role="result"]').empty();
        if (!res) {
            return;
        }
        const statusClass = res.status >= 500 ? 'is-5xx' : (res.status >= 400 ? 'is-4xx' : (res.status >= 300 ? 'is-3xx' : 'is-2xx'));

        const $meta = $('<div/>', {'class': 'aaxis-api__res-meta'});
        $meta.append($('<span/>', {'class': 'aaxis-api__status ' + statusClass, text: res.status + ' ' + (res.statusText || '')}));
        $meta.append($('<span/>', {'class': 'aaxis-api__res-stat', text: res.timeMs + ' ms'}));
        $meta.append($('<span/>', {'class': 'aaxis-api__res-stat', text: this.formatSize(res.size)}));
        $result.append($meta);

        const $tabs = $('<div/>', {'class': 'aaxis-api__res-tabs'});
        ['headers', 'body'].forEach(tab => {
            $tabs.append($('<button/>', {
                type: 'button',
                'class': 'aaxis-api__res-tab' + (tab === this.resultTab ? ' is-active' : ''),
                'data-role': 'res-tab', 'data-restab': tab,
                text: tab === 'headers'
                    ? __('aaxis.tools.api_collection.response_headers')
                    : __('aaxis.tools.api_collection.response_body')
            }));
        });
        $result.append($tabs);

        const $panel = $('<div/>', {'class': 'aaxis-api__res-panel'});
        if (this.resultTab === 'headers') {
            const $h = $('<div/>', {'class': 'aaxis-api__res-headers'});
            res.headers.forEach(h => $h.append($('<div/>').append(
                $('<span/>', {'class': 'aaxis-api__res-hkey', text: h.key + ': '}),
                $('<span/>', {text: h.value})
            )));
            $panel.append($h);
        } else {
            const pre = document.createElement('pre');
            pre.className = 'cm-s-default aaxis-api__res-body';
            const mode = this.modeForContentType(res.contentType);
            let text = res.body;
            if (mode && mode.json) {
                try {
                    text = JSON.stringify(JSON.parse(res.body), null, 2);
                } catch (e) { /* keep raw */ }
            } else if (mode && mode.mode === 'xml') {
                try {
                    text = this.formatXml(res.body);
                } catch (e) { /* keep raw */ }
            }
            if (mode) {
                try {
                    (CodeMirror as any).runMode(text, mode.mode, pre);
                } catch (e) {
                    pre.textContent = text;
                }
            } else {
                pre.textContent = text;
            }
            $panel.append(pre);
        }
        $result.append($panel);
    }

    private onResTab(event: any): void {
        this.resultTab = String($(event.currentTarget).data('restab'));
        this.renderResult();
    }

    private modeForContentType(ct: string): {mode: any; json?: boolean} | null {
        const c = ct.toLowerCase();
        if (c.indexOf('json') !== -1) {
            return {mode: {name: 'javascript', json: true}, json: true};
        }
        if (c.indexOf('html') !== -1) {
            return {mode: 'htmlmixed'};
        }
        if (c.indexOf('xml') !== -1) {
            return {mode: 'xml'};
        }
        return null;
    }

    // --- Run history ---------------------------------------------------------

    private renderRuns(): void {
        const $runs = this.$el.find('[data-role="runs"]').empty();
        if (!this.runs.length) {
            $runs.append($('<li/>', {'class': 'aaxis-api__run-empty', text: __('aaxis.tools.api_collection.no_runs')}));
            return;
        }
        this.runs.forEach(run => {
            const statusClass = (run.status || 0) >= 400 || run.result === 'error' ? 'is-fail' : 'is-ok';
            const $li = $('<li/>', {'class': 'aaxis-api__run'});
            $li.append($('<div/>', {'class': 'aaxis-api__run-line'}).append(
                $('<span/>', {'class': 'aaxis-api__run-method ' + (METHOD_CLASS[run.method] || ''), text: run.method}),
                $('<span/>', {'class': 'aaxis-api__run-status ' + statusClass, text: run.status !== null ? String(run.status) : '—'}),
                $('<span/>', {'class': 'aaxis-api__run-name', text: run.name || '', title: run.name || ''})
            ));
            $li.append($('<div/>', {'class': 'aaxis-api__run-url', text: run.url, title: run.url}));
            $li.append($('<div/>', {'class': 'aaxis-api__run-foot'}).append(
                $('<span/>', {text: run.runAt ? new Date(run.runAt).toLocaleString() : ''}),
                $('<span/>', {text: this.formatSize(run.sizeBytes || 0)})
            ));
            $runs.append($li);
        });
    }

    // --- cURL import / export ------------------------------------------------

    private exportCurl(node: ApiNode): void {
        const parts = ['curl', '-X', node.method || 'GET'];
        (node.headers || []).forEach(h => {
            if (h.key !== '') {
                parts.push('-H', this.shellQuote(h.key + ': ' + h.value));
            }
        });
        if (node.body && node.method !== 'GET' && node.method !== 'HEAD') {
            parts.push('--data', this.shellQuote(node.body));
        }
        let url = node.url || '';
        const query = (node.params || []).filter(p => p.key !== '')
            .map(p => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value)).join('&');
        if (query !== '') {
            url += (url.indexOf('?') !== -1 ? '&' : '?') + query;
        }
        parts.push(this.shellQuote(url));
        const curl = parts.join(' ');

        const $content = $('<div/>').append($('<textarea/>', {'class': 'form-control', rows: 6, readonly: 'readonly', text: curl}));
        const modal = new Modal({
            title: __('aaxis.tools.api_collection.menu_export_curl'),
            content: $content,
            okText: __('aaxis.tools.api_collection.copy'),
            cancelText: __('Close')
        });
        modal.on('ok', () => {
            if (window.navigator.clipboard) {
                window.navigator.clipboard.writeText(curl);
            }
            messenger.notificationFlashMessage('success', __('aaxis.tools.api_collection.copied'));
            modal.close();
        });
        modal.open();
    }

    private shellQuote(value: string): string {
        return "'" + String(value).replace(/'/g, "'\\''") + "'";
    }

    private importCurl(parentId: number): void {
        const $content = $('<div/>').append($('<textarea/>', {
            'class': 'form-control', rows: 6, 'data-role': 'curl-input', placeholder: 'curl https://...'
        }));
        const modal = new Modal({
            title: __('aaxis.tools.api_collection.menu_import_curl'),
            content: $content,
            okText: __('aaxis.tools.api_collection.import'),
            okCloses: false
        });
        modal.on('ok', () => {
            const parsed = this.parseCurl(String(modal.$el.find('[data-role="curl-input"]').val() || '').trim());
            if (!parsed) {
                messenger.notificationFlashMessage('warning', __('aaxis.tools.api_collection.curl_invalid'));
                return;
            }
            this.expanded[parentId] = true;
            this.setBusy(true);
            this.apiFetch(this.urls.create, 'POST', {
                type: 'request', name: parsed.url, parentId,
                method: parsed.method, url: parsed.url, headers: parsed.headers,
                params: [], bodyType: parsed.body ? 'raw' : 'none', body: parsed.body
            }).then(() => this.loadTree())
                .then(() => modal.close())
                .finally(() => this.setBusy(false));
        });
        modal.open();
    }

    private parseCurl(raw: string): {method: string; url: string; headers: KvPair[]; body: string} | null {
        if (raw.indexOf('curl') === -1) {
            return null;
        }
        const tokens = raw.match(/'[^']*'|"[^"]*"|\S+/g) || [];
        const unq = (t: string) => (/^['"].*['"]$/.test(t) ? t.slice(1, -1) : t);
        let method = '';
        let url = '';
        const headers: KvPair[] = [];
        let body = '';
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t === 'curl') {
                continue;
            }
            if (t === '-X' || t === '--request') {
                method = unq(tokens[++i] || 'GET').toUpperCase();
            } else if (t === '-H' || t === '--header') {
                const h = unq(tokens[++i] || '');
                const idx = h.indexOf(':');
                if (idx !== -1) {
                    headers.push({key: h.slice(0, idx).trim(), value: h.slice(idx + 1).trim()});
                }
            } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') {
                body = unq(tokens[++i] || '');
            } else if (url === '' && (t.charAt(0) !== '-' || t.charAt(0) === "'" || t.charAt(0) === '"')) {
                url = unq(t);
            }
        }
        if (url === '') {
            return null;
        }
        if (method === '') {
            method = body !== '' ? 'POST' : 'GET';
        }
        return {method, url, headers, body};
    }

    // --- Misc ----------------------------------------------------------------

    private formatSize(bytes: number): string {
        if (bytes < 1024) {
            return bytes + ' B';
        }
        if (bytes < 1048576) {
            return (bytes / 1024).toFixed(1) + ' KB';
        }
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    private setRunning(running: boolean): void {
        this.running = running;
        this.$el.find('[data-role="send"]').prop('disabled', running);
    }

    private onToggleRightbar(event: any): void {
        event.preventDefault();
        const $bar = this.$el.find('[data-role="rightbar"]');
        const collapsed = $bar.toggleClass('is-collapsed').hasClass('is-collapsed');
        $bar.find('[data-role="rightbar-toggle"] .fa')
            .attr('class', 'fa ' + (collapsed ? 'fa-chevron-left' : 'fa-chevron-right'));
    }

    private onHelp(event: any): void {
        event.preventDefault();
        const html = this.$el.find('[data-role="help-content"]').html();
        const modal = new Modal({
            title: __('aaxis.tools.api_collection.help'),
            content: html, allowOk: false, cancelText: __('Close')
        });
        modal.open();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.closeMenu();
        this.$el.off('.aaxisApi');
        $(window).off('resize.aaxisApi');
        if (this.bodyEditor) {
            this.bodyEditor.toTextArea();
            this.bodyEditor = null;
        }
        super.dispose();
    }
}

export default ApiCollectionComponent;
