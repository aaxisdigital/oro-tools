import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import {
    FakeApi, MARKUP, createComponent, flush, folder, lastModal, request
} from './support/api-collection';

vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

describe('ApiCollectionComponent: collection tree, run history and node actions', () => {
    let $root: any;
    let component: any;
    let api: FakeApi;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const label = (id: number): any => role('tree').find(`[data-role="node-label"][data-id="${id}"]`);
    const names = (): string[] => role('tree').find('.aaxis-api__node-name').toArray().map((el: any) => el.textContent);
    const create = async (options: Record<string, unknown> = {}): Promise<any> => {
        component = await createComponent($root, api, options);
        return component;
    };
    const menuItems = (): string[] =>
        $('.aaxis-api__menu a').toArray().map((a: any) => a.getAttribute('data-action'));
    const openMenu = (id: number): void => {
        role('tree').find(`[data-role="node-menu"][data-id="${id}"]`).trigger('click');
    };
    const pickMenu = (action: string): void => {
        $(`.aaxis-api__menu a[data-action="${action}"]`).trigger('click');
    };

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        api = new FakeApi();
        api.nodes = [
            folder(1, 'Auth'),
            request(2, 'Login', {parentId: 1, method: 'POST', url: 'http://x/login', owned: true}),
            folder(3, 'Legacy', 1),
            request(4, 'Ping', {parentId: 3, owned: false, public: true}),
            request(5, 'Zeta'),
            request(6, 'Alpha', {public: true}),
            folder(7, 'Empty')
        ];
        Modal.instances.length = 0;
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        window.sessionStorage.clear();
    });

    describe('loading and rendering', () => {
        it('requests the tree with the session cookie and remembers the current user', async () => {
            api.currentUserId = 42;

            await create();

            expect(api.fetch).toHaveBeenCalledWith('/tree', {credentials: 'same-origin'});
            expect(component.currentUserId).toBe(42);
        });

        it('lists folders first (alphabetically) then requests, nesting children under expanded folders', async () => {
            await create();

            expect(names()).toEqual(['Auth', 'Legacy', 'Ping', 'Login', 'Empty', 'Alpha', 'Zeta']);
            expect(role('tree').children('li').toArray().map((li: any) =>
                $(li).children('.aaxis-api__node-label').find('.aaxis-api__node-name').text()))
                .toEqual(['Auth', 'Empty', 'Alpha', 'Zeta']);
            expect(label(1).find('.fa').first().hasClass('fa-folder-open')).toBe(true);
            expect(role('tree').find('ul .aaxis-api__node')).toHaveLength(3);
        });

        it('shows a method badge and a public/private padlock on every request', async () => {
            await create();

            expect(label(2).find('.aaxis-api__method-badge').text()).toBe('POST');
            expect(label(2).find('.aaxis-api__method-badge').hasClass('is-post')).toBe(true);
            expect(label(2).find('.aaxis-api__node-lock').hasClass('fa-lock')).toBe(true);
            expect(label(2).find('.aaxis-api__node-lock').attr('title')).toBe('aaxis.tools.api_collection.private');
            expect(label(6).find('.aaxis-api__node-lock').hasClass('fa-unlock-alt')).toBe(true);
            expect(label(6).find('.aaxis-api__node-lock').hasClass('is-public')).toBe(true);
            expect(label(6).find('.aaxis-api__node-lock').attr('title')).toBe('aaxis.tools.api_collection.public');
        });

        it('defaults a request without a method to a GET badge, and an unknown method to no colour class', async () => {
            api.nodes = [request(1, 'NoMethod', {method: null}), request(2, 'Custom', {method: 'PURGE'})];

            await create();

            expect(label(1).find('.aaxis-api__method-badge').text()).toBe('GET');
            expect(label(1).find('.aaxis-api__method-badge').hasClass('is-get')).toBe(true);
            expect(label(2).find('.aaxis-api__method-badge').text()).toBe('PURGE');
            expect(label(2).find('.aaxis-api__method-badge').attr('class')).toBe('aaxis-api__method-badge ');
        });

        it('offers an actions button on every node', async () => {
            await create();

            expect(role('tree').find('[data-role="node-menu"]')).toHaveLength(7);
        });

        it('collapsed folders stay collapsed across reloads; new folders start expanded', async () => {
            await create();

            label(1).trigger('click');
            expect(names()).toEqual(['Auth', 'Empty', 'Alpha', 'Zeta']);
            expect(label(1).find('.fa').first().hasClass('fa-folder')).toBe(true);

            api.nodes.push(folder(8, 'New'));
            await component.loadTree();

            expect(names()).toContain('New');
            expect(names()).not.toContain('Login');
        });

        it('expands a collapsed folder again on the next click', async () => {
            await create();

            label(1).trigger('click');
            label(1).trigger('click');

            expect(names()).toContain('Login');
        });

        it('reports a failed load and keeps an empty tree', async () => {
            api.on('GET /tree', () => { throw new Error('offline'); });

            await create();

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('error', 'aaxis.tools.api_collection.tree_error');
            expect(names()).toEqual([]);
        });

        it('tolerates a payload without nodes, runs or a user', async () => {
            api.on('GET /tree', () => ({}));

            await create();

            expect(component.nodes).toEqual([]);
            expect(component.runs).toEqual([]);
            expect(component.currentUserId).toBeNull();
            expect(role('runs').text()).toBe('aaxis.tools.api_collection.no_runs');
        });

        it('keeps the request editor disabled until a request is open', async () => {
            await create();
            expect(role('main').hasClass('is-disabled')).toBe(true);
            expect(component.bodyEditor.setOption).toHaveBeenLastCalledWith('readOnly', 'nocursor');

            label(2).trigger('click');

            expect(role('main').hasClass('is-disabled')).toBe(false);
            expect(component.bodyEditor.setOption).toHaveBeenCalledWith('readOnly', false);
        });
    });

    describe('filtering', () => {
        it('keeps only matches and their ancestors, forcing everything expanded', async () => {
            await create();
            label(1).trigger('click');

            role('filter').val('PING').trigger('input');

            expect(names()).toEqual(['Auth', 'Legacy', 'Ping']);
            expect(label(1).find('.fa').first().hasClass('fa-folder-open')).toBe(true);
        });

        it('shows nothing when no name matches and everything again once cleared', async () => {
            await create();

            role('filter').val('zzz').trigger('input');
            expect(names()).toEqual([]);

            role('filter').val('').trigger('input');
            expect(names()).toHaveLength(7);
        });
    });

    describe('run history', () => {
        it('lists the runs with method, status, name, URL, time and size', async () => {
            api.runs = [
                {id: 1, name: 'Login', method: 'POST', url: 'http://x/login', status: 200, result: 'ok', sizeBytes: 512, timeMs: 12, runAt: '2026-01-02T03:04:05Z'},
                {id: 2, name: null, method: 'GET', url: 'http://x/big', status: 500, result: 'ok', sizeBytes: 2048, timeMs: 12, runAt: null},
                {id: 3, name: 'Down', method: 'PURGE', url: 'http://x/down', status: null, result: 'error', sizeBytes: null, timeMs: null, runAt: null},
                {id: 4, name: 'Huge', method: 'DELETE', url: 'http://x/huge', status: 204, result: 'ok', sizeBytes: 3 * 1048576, timeMs: 1, runAt: null}
            ];

            await create();

            const $runs = role('runs').find('.aaxis-api__run');
            expect($runs).toHaveLength(4);
            expect($runs.eq(0).find('.aaxis-api__run-method').text()).toBe('POST');
            expect($runs.eq(0).find('.aaxis-api__run-method').hasClass('is-post')).toBe(true);
            expect($runs.eq(0).find('.aaxis-api__run-status').text()).toBe('200');
            expect($runs.eq(0).find('.aaxis-api__run-status').hasClass('is-ok')).toBe(true);
            expect($runs.eq(0).find('.aaxis-api__run-name').text()).toBe('Login');
            expect($runs.eq(0).find('.aaxis-api__run-url').attr('title')).toBe('http://x/login');
            expect($runs.eq(0).find('.aaxis-api__run-foot span').eq(0).text()).toBe(new Date('2026-01-02T03:04:05Z').toLocaleString());
            expect($runs.eq(0).find('.aaxis-api__run-foot span').eq(1).text()).toBe('512 B');
            expect($runs.eq(1).find('.aaxis-api__run-status').hasClass('is-fail')).toBe(true);
            expect($runs.eq(1).find('.aaxis-api__run-name').text()).toBe('');
            expect($runs.eq(1).find('.aaxis-api__run-foot span').eq(0).text()).toBe('');
            expect($runs.eq(1).find('.aaxis-api__run-foot span').eq(1).text()).toBe('2.0 KB');
            expect($runs.eq(2).find('.aaxis-api__run-status').text()).toBe('—');
            expect($runs.eq(2).find('.aaxis-api__run-status').hasClass('is-fail')).toBe(true);
            expect($runs.eq(3).find('.aaxis-api__run-foot span').eq(1).text()).toBe('3.0 MB');
        });

        it('says so when there are no runs', async () => {
            await create();

            expect(role('runs').find('.aaxis-api__run-empty').text()).toBe('aaxis.tools.api_collection.no_runs');
        });

        it('collapses and expands the history side bar', async () => {
            await create();
            const event = $.Event('click');

            role('rightbar-toggle').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(role('rightbar').hasClass('is-collapsed')).toBe(false);
            expect(role('rightbar-toggle').find('.fa').attr('class')).toBe('fa fa-chevron-right');

            role('rightbar-toggle').trigger('click');
            expect(role('rightbar').hasClass('is-collapsed')).toBe(true);
            expect(role('rightbar-toggle').find('.fa').attr('class')).toBe('fa fa-chevron-left');
        });
    });

    describe('opening nodes', () => {
        it('opens a clicked request in the editor', async () => {
            await create();

            label(2).trigger('click');

            expect(component.activeId).toBe(2);
            expect(role('url').val()).toBe('http://x/login');
            expect(role('method').val()).toBe('POST');
            expect(label(2).hasClass('is-active')).toBe(true);
        });

        it('ignores clicks that land on the row action buttons (they have their own handlers)', async () => {
            await create();
            const menuButton = role('tree').find('[data-role="node-menu"][data-id="1"]')[0];

            component.onNodeLabel({target: menuButton, currentTarget: label(1)[0]});

            expect(names()).toContain('Login');
            expect(component.activeId).toBeNull();
        });

        it('ignores a label whose node no longer exists', async () => {
            await create();

            component.onNodeLabel({target: label(2)[0], currentTarget: $('<div data-id="999"></div>')[0]});

            expect(component.activeId).toBeNull();
        });

        it('prompts before leaving a dirty request; Save persists it and then switches', async () => {
            api.nodes.push(request(8, 'Other'));
            await create();
            label(2).trigger('click');
            role('url').val('http://x/changed').trigger('input');
            expect(component.dirty).toBe(true);

            label(8).trigger('click');

            expect(component.activeId).toBe(2);
            const modal: any = lastModal();
            expect(modal.options).toMatchObject({
                title: 'aaxis.tools.api_collection.unsaved_title',
                okText: 'aaxis.tools.api_collection.unsaved_save',
                cancelText: 'aaxis.tools.api_collection.unsaved_keep',
                okCloses: false
            });
            expect(modal.open).toHaveBeenCalled();
            expect(modal.$el.find('.modal-body .aaxis-api__confirm p').text()).toBe('aaxis.tools.api_collection.unsaved_body');

            modal.emit('ok');
            await flush();

            expect(api.callsTo('PUT', '/nodes/2')[0].body).toMatchObject({url: 'http://x/changed', method: 'POST'});
            expect(modal.close).toHaveBeenCalled();
            expect(component.activeId).toBe(8);
            expect(component.dirty).toBe(false);
        });

        it('Discard switches without saving', async () => {
            api.nodes.push(request(8, 'Other'));
            await create();
            label(2).trigger('click');
            role('url').val('http://x/changed').trigger('input');
            label(8).trigger('click');
            const modal: any = lastModal();

            modal.$el.find('.aaxis-api__confirm-discard').trigger('click');
            await flush();

            expect(api.callsTo('PUT', '/nodes/2')).toHaveLength(0);
            expect(modal.close).toHaveBeenCalled();
            expect(component.activeId).toBe(8);
            expect(role('url').val()).toBe('');
        });

        it('stays on the dirty request when the prompt is dismissed', async () => {
            api.nodes.push(request(8, 'Other'));
            await create();
            label(2).trigger('click');
            role('url').val('http://x/changed').trigger('input');

            label(8).trigger('click');

            expect(component.activeId).toBe(2);
            expect(role('url').val()).toBe('http://x/changed');
        });

        it('does not prompt when re-clicking the active request or when it is clean', async () => {
            api.nodes.push(request(8, 'Other'));
            await create();
            label(2).trigger('click');
            role('url').val('http://x/changed').trigger('input');

            label(2).trigger('click');
            expect(Modal.instances).toHaveLength(0);
        });

        it('switches straight away when the current request is clean', async () => {
            api.nodes.push(request(8, 'Other'));
            await create();
            label(2).trigger('click');

            label(8).trigger('click');

            expect(Modal.instances).toHaveLength(0);
            expect(component.activeId).toBe(8);
        });
    });

    describe('context menu', () => {
        it('offers folder actions on a folder', async () => {
            await create();

            openMenu(1);

            expect(menuItems()).toEqual(['add-folder', 'add-request', 'import-curl', 'rename', 'remove']);
            expect($('.aaxis-api__menu').attr('role')).toBe('menu');
            expect($('.aaxis-api__menu a').first().text()).toBe('aaxis.tools.api_collection.menu_add_folder');
        });

        it('offers request actions on a request', async () => {
            await create();

            openMenu(2);

            expect(menuItems()).toEqual(['export-curl', 'duplicate', 'rename', 'remove']);
        });

        it('adds "discard changes" for the dirty active request only', async () => {
            await create();
            label(2).trigger('click');
            role('url').val('http://x/changed').trigger('input');

            openMenu(2);
            expect(menuItems()).toEqual(['export-curl', 'duplicate', 'discard', 'rename', 'remove']);

            openMenu(5);
            expect(menuItems()).toEqual(['export-curl', 'duplicate', 'rename', 'remove']);
        });

        it('replaces an open menu, and ignores an unknown node', async () => {
            await create();

            openMenu(1);
            openMenu(2);
            expect($('.aaxis-api__menu')).toHaveLength(1);

            component.onNodeMenu({preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: $('<b data-id="404"></b>')[0]});
            expect($('.aaxis-api__menu')).toHaveLength(1);
        });

        it('positions the menu under the anchor', async () => {
            await create();
            const button = role('tree').find('[data-role="node-menu"][data-id="1"]')[0];
            vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({bottom: 120, left: 30} as DOMRect);

            openMenu(1);

            expect($('.aaxis-api__menu').css('top')).toBe('120px');
            expect($('.aaxis-api__menu').css('left')).toBe('30px');
        });

        it('closes after a choice, and on a mousedown outside (not inside) the menu', async () => {
            await create();
            vi.spyOn(window, 'prompt').mockReturnValue(null);

            openMenu(1);
            vi.advanceTimersByTime(0);
            $('.aaxis-api__menu').trigger('mousedown');
            expect($('.aaxis-api__menu')).toHaveLength(1);
            $(document.body).trigger('mousedown');
            expect($('.aaxis-api__menu')).toHaveLength(0);

            openMenu(1);
            pickMenu('add-folder');
            expect($('.aaxis-api__menu')).toHaveLength(0);
        });

        it('does not run an action for a node that vanished meanwhile', async () => {
            await create();
            const prompt = vi.spyOn(window, 'prompt');

            component.onMenuAction('add-folder', 404);

            expect(prompt).not.toHaveBeenCalled();
        });
    });

    describe('adding, renaming, removing and duplicating', () => {
        it('creates a root folder from the sidebar button', async () => {
            vi.spyOn(window, 'prompt').mockReturnValue('  Payments  ');
            await create();

            role('add-root-folder').trigger('click');
            await flush();

            expect(api.callsTo('POST', '/nodes')[0].body).toEqual({type: 'folder', name: 'Payments', parentId: null});
            expect(api.callsTo('POST', '/nodes')[0].headers).toEqual({'Content-Type': 'application/json', 'X-CSRF-Header': ''});
            expect(api.callsTo('GET', '/tree')).toHaveLength(2);
        });

        it('creates a sub-folder from the menu and expands the parent', async () => {
            vi.spyOn(window, 'prompt').mockReturnValue('Sub');
            await create();
            label(7).trigger('click');
            expect(component.expanded[7]).toBe(false);
            openMenu(7);

            pickMenu('add-folder');
            await flush();

            expect(api.callsTo('POST', '/nodes')[0].body).toEqual({type: 'folder', name: 'Sub', parentId: 7});
            expect(component.expanded[7]).toBe(true);
        });

        it.each([
            ['cancelled', null],
            ['blank', '   ']
        ])('creates nothing when the folder prompt is %s', async (_label, answer) => {
            vi.spyOn(window, 'prompt').mockReturnValue(answer as any);
            await create();

            role('add-root-folder').trigger('click');
            await flush();

            expect(api.callsTo('POST', '/nodes')).toHaveLength(0);
        });

        it('shows the busy overlay while a change is in flight', async () => {
            vi.spyOn(window, 'prompt').mockReturnValue('Slow');
            let release: () => void = () => undefined;
            api.on('POST /nodes', () => new Promise(resolve => { release = () => resolve({success: true}); }));
            await create();

            role('add-root-folder').trigger('click');

            expect(role('sidebar').hasClass('is-busy')).toBe(true);
            expect(role('busy').prop('hidden')).toBe(false);

            release();
            await flush();
            expect(role('sidebar').hasClass('is-busy')).toBe(false);
            expect(role('busy').prop('hidden')).toBe(true);
        });

        it('adds a request under a folder and opens it', async () => {
            vi.spyOn(window, 'prompt').mockReturnValue(' Health ');
            api.on('POST /nodes', body => {
                api.nodes.push(request(9, body.name, {parentId: body.parentId}));
                return {success: true, node: {id: 9}};
            });
            await create();
            label(7).trigger('click');
            openMenu(7);

            pickMenu('add-request');
            await flush();

            expect(api.callsTo('POST', '/nodes')[0].body)
                .toEqual({type: 'request', name: 'Health', parentId: 7, method: 'GET', url: '', bodyType: 'none'});
            expect(component.expanded[7]).toBe(true);
            expect(component.activeId).toBe(9);
            expect(label(9).hasClass('is-active')).toBe(true);
        });

        it.each([
            ['the response carries no node', () => ({success: true})],
            ['the new node is missing from the reloaded tree', () => ({success: true, node: {id: 99}})]
        ])('does not open anything when %s', async (_label, handler) => {
            vi.spyOn(window, 'prompt').mockReturnValue('Ghost');
            api.on('POST /nodes', handler);
            await create();
            openMenu(1);

            pickMenu('add-request');
            await flush();

            expect(component.activeId).toBeNull();
        });

        it('does not add a request for a blank name', async () => {
            vi.spyOn(window, 'prompt').mockReturnValue(' ');
            await create();
            openMenu(1);

            pickMenu('add-request');
            await flush();

            expect(api.callsTo('POST', '/nodes')).toHaveLength(0);
        });

        it('renames a node, proposing its current name', async () => {
            const prompt = vi.spyOn(window, 'prompt').mockReturnValue(' Sign in ');
            await create();
            openMenu(2);

            pickMenu('rename');
            await flush();

            expect(prompt).toHaveBeenCalledWith('aaxis.tools.api_collection.prompt_rename', 'Login');
            expect(api.callsTo('PUT', '/nodes/2')[0].body).toEqual({name: 'Sign in'});
        });

        it.each([['unchanged', 'Login'], ['blank', ''], ['cancelled', null]])('does not rename when the answer is %s', async (_label, answer) => {
            vi.spyOn(window, 'prompt').mockReturnValue(answer as any);
            await create();
            openMenu(2);

            pickMenu('rename');
            await flush();

            expect(api.callsTo('PUT', '/nodes/2')).toHaveLength(0);
        });

        it('duplicates a request', async () => {
            await create();
            openMenu(2);

            pickMenu('duplicate');
            await flush();

            expect(api.callsTo('POST', '/nodes/2/duplicate')).toHaveLength(1);
            expect(api.callsTo('POST', '/nodes/2/duplicate')[0].body).toBeUndefined();
            expect(api.callsTo('GET', '/tree')).toHaveLength(2);
        });

        it('asks for confirmation before removing and does nothing when declined', async () => {
            const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
            await create();
            openMenu(2);

            pickMenu('remove');
            await flush();

            expect(confirm).toHaveBeenCalledWith('aaxis.tools.api_collection.confirm_remove {"name":"Login"}');
            expect(api.callsTo('DELETE', '/nodes/2')).toHaveLength(0);
        });

        it('removes a confirmed node with a CSRF-protected DELETE and reloads the tree', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await create();
            openMenu(5);

            pickMenu('remove');
            await flush();

            expect(api.callsTo('DELETE', '/nodes/5')[0].headers).toEqual({'X-CSRF-Header': ''});
            expect(api.callsTo('GET', '/tree')).toHaveLength(2);
        });

        it('closes the editor when the open request is removed', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await create();
            label(2).trigger('click');
            role('url').val('http://x/changed').trigger('input');
            openMenu(2);

            pickMenu('remove');
            await flush();

            expect(component.activeId).toBeNull();
            expect(component.dirty).toBe(false);
        });

        it('keeps the editor open when a different node is removed', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            await create();
            label(2).trigger('click');
            openMenu(5);

            pickMenu('remove');
            await flush();

            expect(component.activeId).toBe(2);
        });

        it.each([
            ['the server message', {success: false, message: 'Not yours'}, 'Not yours'],
            ['a generic message', {success: false}, 'aaxis.tools.api_collection.error']
        ])('flashes %s when the removal is refused, and does not reload', async (_label, body, expected) => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            api.on('DELETE /nodes/5', () => body);
            await create();
            openMenu(5);

            pickMenu('remove');
            await flush();

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('error', expected);
            expect(api.callsTo('GET', '/tree')).toHaveLength(1);
            expect(role('sidebar').hasClass('is-busy')).toBe(false);
        });
    });

    describe('visibility (padlock)', () => {
        it('flips a request between private and public', async () => {
            await create();

            const event = $.Event('click');
            label(2).find('[data-role="node-lock"]').trigger(event);
            await flush();

            expect(event.isDefaultPrevented()).toBe(true);
            expect(api.callsTo('PUT', '/nodes/2')[0].body).toEqual({public: true});
            expect(component.activeId).toBeNull();

            label(6).find('[data-role="node-lock"]').trigger('click');
            await flush();
            expect(api.callsTo('PUT', '/nodes/6')[0].body).toEqual({public: false});
        });

        it('warns instead when the request belongs to someone else', async () => {
            await create();

            label(4).find('[data-role="node-lock"]').trigger('click');
            await flush();

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('warning', 'aaxis.tools.api_collection.not_owner');
            expect(api.callsTo('PUT', '/nodes/4')).toHaveLength(0);
        });

        it('ignores a padlock whose node vanished', async () => {
            await create();

            component.onLockToggle({preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: $('<b data-id="404"></b>')[0]});
            await flush();

            expect(api.callsTo('PUT', '/nodes/404')).toHaveLength(0);
        });
    });

    describe('help and dispose', () => {
        it('opens the help in a close-only modal', async () => {
            await create();
            const event = $.Event('click');

            role('help').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(lastModal().options).toMatchObject({title: 'aaxis.tools.api_collection.help', allowOk: false, cancelText: 'Close'});
            expect(lastModal().options.content).toContain('Api help');
            expect(lastModal().open).toHaveBeenCalled();
        });

        it('unbinds handlers, closes the menu and releases the editor on dispose (once)', async () => {
            await create();
            const editor = component.bodyEditor;
            openMenu(1);

            component.dispose();
            component.dispose();

            expect($('.aaxis-api__menu')).toHaveLength(0);
            expect(editor.toTextArea).toHaveBeenCalledTimes(1);
            expect(component.bodyEditor).toBeNull();
            label(1).trigger('click');
            expect(names()).toContain('Login');
            expect(component.disposed).toBe(true);
        });
    });
});
