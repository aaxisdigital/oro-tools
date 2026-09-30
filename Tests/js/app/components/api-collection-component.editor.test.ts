import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import CodeMirror from 'codemirror';
import messenger from 'oroui/js/messenger';
import {FakeApi, MARKUP, createComponent, flush, request} from './support/api-collection';

vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

describe('ApiCollectionComponent: request editor', () => {
    let $root: any;
    let component: any;
    let api: FakeApi;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const label = (id: number): any => role('tree').find(`[data-role="node-label"][data-id="${id}"]`);
    const create = async (): Promise<any> => {
        component = await createComponent($root, api);
        return component;
    };
    const rows = (which: 'params' | 'headers'): Array<[string, string]> =>
        role(`${which}-rows`).find('.aaxis-api__kv-row').toArray().map((row: any): [string, string] => [
            $(row).find('.aaxis-api__kv-key').val() as string,
            $(row).find('.aaxis-api__kv-value').val() as string
        ]);
    const open = async (id: number): Promise<void> => {
        label(id).trigger('click');
        await flush();
    };
    const type = (selector: string, value: string): void => {
        role(selector).val(value).trigger('input');
    };
    const editor = (): any => component.bodyEditor;

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        api = new FakeApi();
        api.nodes = [
            request(1, 'Full', {
                method: 'PUT', url: 'http://x/items', bodyType: 'json', body: '{"a":1}',
                params: [{key: 'page', value: '2'}], headers: [{key: 'X-Trace', value: 'abc'}]
            }),
            request(2, 'Bare', {method: null, url: null, bodyType: null, body: null, params: null, headers: null}),
            request(3, 'Foreign', {owned: false, public: true, url: 'http://x/foreign'}),
            request(4, 'Xml', {method: 'POST', bodyType: 'xml', body: '<a/>'})
        ];
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        window.sessionStorage.clear();
    });

    describe('body editor', () => {
        it('turns the body textarea into a wrapped, line-numbered 160 px CodeMirror', async () => {
            await create();

            expect(CodeMirror.fromTextArea).toHaveBeenCalledWith(role('body')[0], {lineNumbers: true, lineWrapping: true, mode: null});
            expect(editor().setSize).toHaveBeenCalledWith('100%', '160px');
        });

        it('works without a body textarea, falling back to a plain field read', async () => {
            role('body').remove();

            await create();
            await open(1);

            expect(component.bodyEditor).toBeNull();
            expect(component.collectRequest().body).toBe('');
            component.onBeautify();
            component.fitBodyEditor();
            component.decorateBody();
            component.onBodyTypeChange();
            expect(() => component.dispose()).not.toThrow();
        });
    });

    describe('loading a request', () => {
        it('fills the method, URL, body type, body and key/value rows (plus a trailing blank row)', async () => {
            await create();

            await open(1);

            expect(role('method').val()).toBe('PUT');
            expect(role('url').val()).toBe('http://x/items');
            expect(role('body-type').val()).toBe('json');
            expect(editor().getValue()).toBe('{"a":1}');
            expect(editor().setOption).toHaveBeenCalledWith('mode', {name: 'javascript', json: true});
            expect(rows('params')).toEqual([['page', '2'], ['', '']]);
            expect(rows('headers')).toEqual([['X-Trace', 'abc'], ['', '']]);
            expect(role('beautify').prop('hidden')).toBe(false);
            expect(role('params-rows').find('.aaxis-api__kv-key').first().attr('placeholder')).toBe('aaxis.tools.api_collection.key');
            expect(role('params-rows').find('.aaxis-api__kv-value').first().attr('placeholder')).toBe('aaxis.tools.api_collection.value');
        });

        it('uses defaults for a request with empty fields', async () => {
            await create();

            await open(2);

            expect(role('method').val()).toBe('GET');
            expect(role('url').val()).toBe('');
            expect(role('body-type').val()).toBe('none');
            expect(editor().getValue()).toBe('');
            expect(editor().setOption).toHaveBeenCalledWith('mode', null);
            expect(rows('params')).toEqual([['', '']]);
            expect(role('beautify').prop('hidden')).toBe(true);
        });

        it('highlights XML bodies as xml', async () => {
            await create();

            await open(4);

            expect(editor().setOption).toHaveBeenCalledWith('mode', 'xml');
            expect(role('beautify').prop('hidden')).toBe(false);
        });

        it('does not count the load itself as an edit', async () => {
            await create();

            await open(1);
            vi.advanceTimersByTime(50);

            expect(component.dirty).toBe(false);
            expect(label(1).hasClass('is-dirty')).toBe(false);
            expect(component.snapshot).toEqual({
                method: 'PUT', url: 'http://x/items', bodyType: 'json', body: '{"a":1}',
                params: [{key: 'page', value: '2'}], headers: [{key: 'X-Trace', value: 'abc'}]
            });
        });
    });

    describe('collecting the request', () => {
        it('trims the URL and header/param names, and drops rows without a name', async () => {
            await create();
            await open(2);
            role('params-rows').find('.aaxis-api__kv-row').first().find('.aaxis-api__kv-key').val('  q  ');
            role('params-rows').find('.aaxis-api__kv-row').first().find('.aaxis-api__kv-value').val(' spaced ');
            role('add-param').trigger('click');
            role('params-rows').find('.aaxis-api__kv-row').last().find('.aaxis-api__kv-value').val('orphan');
            role('url').val('  http://x/y  ');
            role('method').val('DELETE');
            role('body-type').val('raw');
            editor().setValue('payload');

            expect(component.collectRequest()).toEqual({
                method: 'DELETE', url: 'http://x/y', bodyType: 'raw', body: 'payload',
                params: [{key: 'q', value: ' spaced '}], headers: []
            });
        });
    });

    describe('dirty tracking', () => {
        it.each([
            ['the URL', () => 'url'],
            ['the body type', () => 'body-type']
        ])('flags an edit of %s and decorates the tree row with a save button', async (_label, field) => {
            await create();
            await open(1);

            role(field()).trigger('input');

            expect(component.dirty).toBe(true);
            expect(label(1).hasClass('is-dirty')).toBe(true);
            expect(label(1).find('[data-role="node-save"]')).toHaveLength(1);
        });

        it('flags an edit of a parameter or header value', async () => {
            await create();
            await open(1);

            role('params-rows').find('.aaxis-api__kv-value').first().val('3').trigger('input');

            expect(component.dirty).toBe(true);
        });

        it('flags an edit in the body editor and re-decorates on the next frame', async () => {
            await create();
            await open(1);
            const decorate = vi.spyOn(component, 'decorateBody');

            editor().emit('change');
            editor().emit('change');
            expect(component.dirty).toBe(true);
            expect(decorate).not.toHaveBeenCalled();
            vi.advanceTimersByTime(20);

            expect(decorate).toHaveBeenCalledTimes(1);
        });

        it('never flags a request the user does not own (no save button either)', async () => {
            await create();
            await open(3);

            role('url').val('http://x/hacked').trigger('input');
            editor().emit('change');

            expect(component.dirty).toBe(false);
            expect(label(3).find('[data-role="node-save"]')).toHaveLength(0);
        });

        it('does nothing when no request is open', async () => {
            await create();

            role('url').val('typing').trigger('input');

            expect(component.dirty).toBe(false);
        });

        it('adds blank rows and removes rows, each counting as an edit', async () => {
            await create();
            await open(1);

            role('add-header').trigger('click');
            expect(rows('headers')).toHaveLength(3);
            expect(component.dirty).toBe(true);

            component.dirty = false;
            role('add-param').trigger('click');
            expect(rows('params')).toHaveLength(3);
            expect(component.dirty).toBe(true);

            component.dirty = false;
            role('params-rows').find('[data-role="kv-del"]').first().trigger('click');
            expect(rows('params')).toEqual([['', ''], ['', '']]);
            expect(component.dirty).toBe(true);
        });
    });

    describe('method and body type', () => {
        it('reflects a changed method on the tree badge immediately', async () => {
            await create();
            await open(1);

            role('method').val('PATCH').trigger('change');

            expect(component.nodes[0].method).toBe('PATCH');
            expect(label(1).find('.aaxis-api__method-badge').text()).toBe('PATCH');
            expect(component.dirty).toBe(true);
        });

        it('leaves the node of a foreign request alone', async () => {
            await create();
            await open(3);

            role('method').val('POST').trigger('change');

            expect(component.nodes[2].method).toBe('GET');
        });

        it('ignores method changes while no request is open', async () => {
            await create();

            role('method').val('POST').trigger('change');

            expect(component.dirty).toBe(false);
        });

        it.each([
            ['json', {name: 'javascript', json: true}, false],
            ['xml', 'xml', false],
            ['form', null, true],
            ['raw', null, true],
            ['none', null, true]
        ])('switches the editor mode and the beautify button for %s', async (bodyType, mode, hidden) => {
            await create();
            await open(2);

            role('body-type').val(bodyType).trigger('change');

            expect(editor().setOption).toHaveBeenLastCalledWith('mode', mode);
            expect(role('beautify').prop('hidden')).toBe(hidden);
        });

        it('treats an empty body type as none', async () => {
            await create();
            role('body-type').empty();

            component.onBodyTypeChange();

            expect(role('beautify').prop('hidden')).toBe(true);
        });
    });

    describe('tabs and maximizing', () => {
        it('shows only the chosen panel and marks the tab active', async () => {
            await create();

            role('tab').filter('[data-tab="headers"]').trigger('click');

            expect(role('tab').filter('.is-active').attr('data-tab')).toBe('headers');
            expect(role('panel').toArray().map((p: any) => [p.getAttribute('data-tab'), p.hidden]))
                .toEqual([['params', true], ['body', true], ['headers', false]]);
            expect(component.activeTab).toBe('headers');
        });

        it('sizes the body editor when the body tab opens', async () => {
            await create();
            editor().setSize.mockClear();

            role('tab').filter('[data-tab="body"]').trigger('click');

            expect(editor().setSize).toHaveBeenCalledWith('100%', '160px');
            expect(editor().refresh).toHaveBeenCalled();
        });

        it('re-fits the body editor on window resize only while the body tab is open', async () => {
            await create();
            editor().setSize.mockClear();

            $(window).trigger('resize');
            expect(editor().setSize).not.toHaveBeenCalled();

            role('tab').filter('[data-tab="body"]').trigger('click');
            editor().setSize.mockClear();
            $(window).trigger('resize');
            expect(editor().setSize).toHaveBeenCalledTimes(1);
        });

        it('maximizes the request area, swapping the icon and stretching the editor to the panel', async () => {
            await create();
            vi.spyOn($.fn, 'height').mockReturnValue(500);
            vi.spyOn($.fn, 'outerHeight').mockReturnValue(40);
            editor().setSize.mockClear();

            role('max-request').trigger('click');

            expect(role('main').hasClass('is-req-max')).toBe(true);
            expect(role('max-request').find('.fa').attr('class')).toBe('fa fa-compress');
            expect(role('max-response').find('.fa').attr('class')).toBe('fa fa-expand');
            expect(editor().setSize).not.toHaveBeenCalled();
            vi.advanceTimersByTime(0);
            expect(editor().setSize).toHaveBeenCalledWith('100%', '444px');
        });

        it('never shrinks the maximized editor below 200 px', async () => {
            await create();

            role('max-request').trigger('click');
            vi.advanceTimersByTime(0);

            expect(editor().setSize).toHaveBeenLastCalledWith('100%', '200px');
        });

        it('restores the fixed editor height when un-maximized', async () => {
            await create();
            role('max-request').trigger('click');
            role('max-request').trigger('click');
            editor().setSize.mockClear();

            vi.advanceTimersByTime(0);

            expect(role('main').hasClass('is-req-max')).toBe(false);
            expect(editor().setSize).toHaveBeenCalledWith('100%', '160px');
        });

        it('maximizes the response area exclusively of the request area', async () => {
            await create();
            role('max-request').trigger('click');

            role('max-response').trigger('click');

            expect(role('main').hasClass('is-res-max')).toBe(true);
            expect(role('main').hasClass('is-req-max')).toBe(false);
            expect(role('max-response').find('.fa').attr('class')).toBe('fa fa-compress');
            expect(role('max-request').find('.fa').attr('class')).toBe('fa fa-expand');

            role('max-response').trigger('click');
            expect(role('main').hasClass('is-res-max')).toBe(false);
        });
    });

    describe('beautify', () => {
        it('pretty-prints a JSON body', async () => {
            await create();
            await open(1);
            editor().setValue('{"a":1,"b":[1,2]}');

            role('beautify').trigger('click');

            expect(editor().getValue()).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
        });

        it('warns and leaves the text alone when the JSON is invalid', async () => {
            await create();
            await open(1);
            editor().setValue('{oops');

            role('beautify').trigger('click');

            expect(editor().getValue()).toBe('{oops');
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('warning', 'aaxis.tools.api_collection.beautify_error');
        });

        it('indents an XML body', async () => {
            await create();
            await open(4);
            editor().setValue('<root><item>1</item><empty/><list>\n   <e>x</e></list></root>');

            role('beautify').trigger('click');

            expect(editor().getValue()).toBe('<root>\n  <item>1</item>\n  <empty/>\n  <list>\n    <e>x</e>\n  </list>\n</root>');
        });

        it('leaves other body types untouched', async () => {
            await create();
            await open(2);
            role('body-type').val('raw');
            editor().setValue('  raw  ');

            component.onBeautify();

            expect(editor().getValue()).toBe('  raw  ');
            expect(messenger.notificationFlashMessage).not.toHaveBeenCalled();
        });

        it('never lets the indentation go negative on stray closing tags', async () => {
            await create();

            expect(component.formatXml('</a></b><c>1</c>')).toBe('</a>\n</b>\n<c>1</c>');
        });
    });

    describe('saving', () => {
        it('PUTs the edited request, updates the node in place and confirms', async () => {
            await create();
            await open(1);
            type('url', 'http://x/v2');
            role('params-rows').find('.aaxis-api__kv-key').last().val('sort');
            role('params-rows').find('.aaxis-api__kv-value').last().val('asc');

            role('tree').find('[data-role="node-save"]').trigger('click');
            await flush();

            const put = api.callsTo('PUT', '/nodes/1');
            expect(put).toHaveLength(1);
            expect(put[0].body).toEqual({
                method: 'PUT', url: 'http://x/v2', bodyType: 'json', body: '{"a":1}',
                params: [{key: 'page', value: '2'}, {key: 'sort', value: 'asc'}],
                headers: [{key: 'X-Trace', value: 'abc'}]
            });
            expect(component.nodes[0].url).toBe('http://x/v2');
            expect(component.dirty).toBe(false);
            expect(component.snapshot.url).toBe('http://x/v2');
            expect(label(1).find('[data-role="node-save"]')).toHaveLength(0);
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('success', 'aaxis.tools.api_collection.saved');
        });

        it('a silent save (before leaving or sending) shows no confirmation and keeps the tree as is', async () => {
            await create();
            await open(1);
            type('url', 'http://x/v3');

            component.saveActive(true);
            await flush();

            expect(api.callsTo('PUT', '/nodes/1')).toHaveLength(1);
            expect(messenger.notificationFlashMessage).not.toHaveBeenCalled();
        });

        it('does not save a foreign request or when nothing is open', async () => {
            await create();
            component.saveActive(false);
            await open(3);

            component.saveActive(false);
            await flush();

            expect(api.callsTo('PUT', '/nodes/3')).toHaveLength(0);
        });
    });

    describe('discarding changes', () => {
        it('reloads the last saved state into the editor', async () => {
            await create();
            await open(1);
            role('method').val('DELETE').trigger('change');
            type('url', 'http://x/changed');
            editor().setValue('changed');
            expect(label(1).find('.aaxis-api__method-badge').text()).toBe('DELETE');

            role('tree').find('[data-role="node-menu"][data-id="1"]').trigger('click');
            $('.aaxis-api__menu a[data-action="discard"]').trigger('click');

            expect(role('method').val()).toBe('PUT');
            expect(role('url').val()).toBe('http://x/items');
            expect(editor().getValue()).toBe('{"a":1}');
            expect(component.nodes[0].method).toBe('PUT');
            expect(component.dirty).toBe(false);
            expect(label(1).hasClass('is-dirty')).toBe(false);
        });

        it('does nothing before any request was loaded', async () => {
            await create();

            expect(() => component.discard()).not.toThrow();
            expect(component.dirty).toBe(false);
        });

        it('just clears the dirty flag when the request vanished meanwhile', async () => {
            await create();
            await open(1);
            type('url', 'x');
            component.nodes.splice(0, 1);

            component.discard();

            expect(component.dirty).toBe(false);
        });
    });
});
