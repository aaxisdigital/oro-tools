import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import Select2View from 'oroform/js/app/views/select2-view';
import {FakeApi, MARKUP, createComponent, flush, folder, lastModal, request} from './support/api-collection';

vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

// Records every enhanced <select>; `throwOnCreate` simulates Select2 failing to initialise.
vi.mock('oroform/js/app/views/select2-view', () => {
    class FakeSelect2View {
        static instances: FakeSelect2View[] = [];
        static throwOnCreate = false;
        dispose = vi.fn();

        constructor(public options: any) {
            if (FakeSelect2View.throwOnCreate) {
                throw new Error('select2 unavailable');
            }
            FakeSelect2View.instances.push(this);
        }
    }
    return {default: FakeSelect2View};
});

/** Test-side token encoder, independent of the component's own. */
const tokenOf = (def: Record<string, unknown>): string =>
    '{{res:' + btoa(String.fromCodePoint(...new TextEncoder().encode(JSON.stringify(def)))) + '}}';
const payloadOf = (token: string): any => {
    const b64 = /\{\{res:([^}]+)\}\}/.exec(token)![1];
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
};
const ref = (r: number, overrides: Record<string, unknown> = {}): Record<string, unknown> =>
    ({r, src: 'body', run: 'ifEmpty', ...overrides});

const stored = (body: string, extra: Record<string, unknown> = {}): any => ({
    status: 200, statusText: 'OK', contentType: 'application/json', body, headers: [], timeMs: 1, size: body.length, at: 'x', ...extra
});

describe('ApiCollectionComponent: response references', () => {
    let $root: any;
    let component: any;
    let api: FakeApi;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const label = (id: number): any => role('tree').find(`[data-role="node-label"][data-id="${id}"]`);
    const create = async (): Promise<any> => {
        component = await createComponent($root, api);
        return component;
    };
    const store = (id: number, body: string, extra: Record<string, unknown> = {}): void => {
        window.sessionStorage.setItem('aaxis.api.resp.' + id, JSON.stringify(stored(body, extra)));
    };
    const executeCalls = (): any[] => api.callsTo('POST', '/execute');
    const respondWith = (body: string, extra: Record<string, unknown> = {}): void => {
        api.on('POST /execute', () => ({response: {success: true, status: 200, contentType: 'application/json', body, headers: [], ...extra}}));
    };

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        api = new FakeApi();
        api.nodes = [
            folder(10, 'Auth'),
            request(1, 'Login', {parentId: 10, method: 'POST', url: 'http://x/login'}),
            request(2, 'Source', {url: 'http://x/source', method: 'GET'}),
            request(3, 'Target', {url: 'http://x/target', method: 'PUT'})
        ];
        (Select2View as any).instances.length = 0;
        (Select2View as any).throwOnCreate = false;
        Modal.instances.length = 0;
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        window.sessionStorage.clear();
    });

    describe('token codec', () => {
        it('encodes only the fields that apply to the source', async () => {
            await create();

            expect(payloadOf(component.encodeRef({r: 2, src: 'body', run: 'ifEmpty', h: 'ignored', q: '$.token'})))
                .toEqual({r: 2, src: 'body', run: 'ifEmpty', q: '$.token'});
            expect(payloadOf(component.encodeRef({r: 2, src: 'header', run: 'none', h: 'Authorization'})))
                .toEqual({r: 2, src: 'header', run: 'none', h: 'Authorization'});
            expect(payloadOf(component.encodeRef({r: 2, src: 'header', run: 'always', h: ''})))
                .toEqual({r: 2, src: 'header', run: 'always'});
            expect(payloadOf(component.encodeRef({r: 2, src: 'body', run: 'always', q: ''})))
                .toEqual({r: 2, src: 'body', run: 'always'});
        });

        it('produces a token made of the {{res:...}} delimiters and a base64 payload only', async () => {
            await create();

            expect(component.encodeRef({r: 1, src: 'body', run: 'ifEmpty'})).toMatch(/^\{\{res:[A-Za-z0-9+/=]+\}\}$/);
        });

        it('round-trips a definition, including non-ASCII filters', async () => {
            await create();
            const def = {r: 7, src: 'body', run: 'always', h: undefined, q: '$.名前.ключ'};

            const token = component.encodeRef(def);
            const decoded = component.decodeRef(/\{\{res:([^}]+)\}\}/.exec(token)![1]);

            expect(decoded).toEqual(def);
        });

        it('normalises unknown source and run values when decoding', async () => {
            await create();

            const decoded = component.decodeRef(/\{\{res:([^}]+)\}\}/.exec(tokenOf({r: 4, src: 'cookie', run: 'sometimes'}))![1]);

            expect(decoded).toEqual({r: 4, src: 'body', h: undefined, q: undefined, run: 'ifEmpty'});
        });

        it.each([
            ['not base64', '!!!'],
            ['base64 of non-JSON', btoa('plain text')],
            ['JSON without a numeric request id', btoa('{"r":"2"}')],
            ['JSON null', btoa('null')]
        ])('decodes %s to no reference', async (_label, payload) => {
            await create();

            expect(component.decodeRef(payload)).toBeNull();
        });

        it('finds every token in a string, keeping undecodable ones as unresolved', async () => {
            await create();
            const good = tokenOf(ref(2));

            const found = component.collectRefs(`a ${good} b {{res:AAAA}} c {{other}} ${good}`);

            expect(found.map((f: any) => [f.raw, f.def === null ? null : f.def.r])).toEqual([[good, 2], ['{{res:AAAA}}', null], [good, 2]]);
        });
    });

    describe('resolving references in text', () => {
        it('returns text without tokens untouched (even empty or missing text)', async () => {
            await create();

            expect(await component.resolveString('plain', [])).toEqual({value: 'plain', warnings: []});
            expect(await component.resolveString('', [])).toEqual({value: '', warnings: []});
            expect((await component.resolveString(undefined, [])).value).toBeUndefined();
        });

        it('substitutes the referenced value from the session cache', async () => {
            store(2, '{"token":"abc"}');
            await create();

            const result = await component.resolveString('Bearer ' + tokenOf(ref(2, {q: '$.token'})), []);

            expect(result).toEqual({value: 'Bearer abc', warnings: []});
            expect(executeCalls()).toHaveLength(0);
        });

        it('resolves a repeated token only once', async () => {
            respondWith('{"token":"abc"}');
            await create();
            const token = tokenOf(ref(2, {q: 'token', run: 'always'}));

            const result = await component.resolveString(`${token}-${token}`, []);

            expect(result.value).toBe('abc-abc');
            expect(executeCalls()).toHaveLength(1);
        });

        it('replaces an undecodable token with nothing and warns', async () => {
            await create();

            const result = await component.resolveString('id={{res:AAAA}}!', []);

            expect(result).toEqual({value: 'id=!', warnings: ['aaxis.tools.api_collection.ref_warn_invalid']});
        });

        it('resolves the URL, parameter values, header values and body, but not names', async () => {
            store(2, '{"t":"TOK"}');
            await create();
            const t = tokenOf(ref(2, {q: '$.t'}));

            const {data, warnings} = await component.resolveRequestData({
                method: 'POST', url: `http://x/${t}`, bodyType: 'json', body: `{"k":"${t}"}`,
                params: [{key: t, value: t}], headers: [{key: 'Authorization', value: `Bearer ${t}`}]
            }, []);

            expect(warnings).toEqual([]);
            expect(data).toEqual({
                method: 'POST', url: 'http://x/TOK', bodyType: 'json', body: '{"k":"TOK"}',
                params: [{key: t, value: 'TOK'}], headers: [{key: 'Authorization', value: 'Bearer TOK'}]
            });
        });

        it('lists each distinct warning once, however many fields raised it', async () => {
            await create();

            const {warnings} = await component.resolveRequestData({
                method: 'GET', url: '{{res:AAAA}}', bodyType: 'none', body: '{{res:AAAA}}',
                params: [{key: 'a', value: '{{res:AAAA}}'}], headers: []
            }, []);

            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_invalid']);
        });
    });

    describe('obtaining the referenced response', () => {
        it.each([
            ['is not in the collection', 99],
            ['is a folder', 10]
        ])('warns when the source request %s', async (_label, id) => {
            await create();
            const warnings: string[] = [];

            const result = await component.ensureResponse(ref(id), [], warnings);

            expect(result).toBeNull();
            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_missing']);
        });

        it.each(['none', 'ifEmpty'])('uses the cached response under policy %s without a network call', async run => {
            store(2, 'cached');
            await create();

            const result = await component.ensureResponse(ref(2, {run}), [], []);

            expect(result.body).toBe('cached');
            expect(executeCalls()).toHaveLength(0);
        });

        it('never auto-runs under the "none" policy, and warns that nothing is cached', async () => {
            await create();
            const warnings: string[] = [];

            const result = await component.ensureResponse(ref(2, {run: 'none'}), [], warnings);

            expect(result).toBeNull();
            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_nostored {"name":"Source"}']);
            expect(executeCalls()).toHaveLength(0);
        });

        it('runs the source request when nothing is cached ("ifEmpty"), and caches the result', async () => {
            respondWith('{"a":1}');
            await create();

            const result = await component.ensureResponse(ref(2), [], []);

            expect(executeCalls()).toHaveLength(1);
            expect(executeCalls()[0].body).toEqual({
                requestId: 2, name: 'Source', method: 'GET', url: 'http://x/source',
                params: [], headers: [], bodyType: 'none', body: ''
            });
            expect(result.body).toBe('{"a":1}');
            expect(JSON.parse(window.sessionStorage.getItem('aaxis.api.resp.2')!).body).toBe('{"a":1}');
        });

        it('runs the source request again under the "always" policy even when cached', async () => {
            store(2, 'old');
            respondWith('fresh');
            await create();

            const result = await component.ensureResponse(ref(2, {run: 'always'}), [], []);

            expect(result.body).toBe('fresh');
            expect(executeCalls()).toHaveLength(1);
        });

        it('sends defaults for a source request with missing fields', async () => {
            api.nodes.push(request(5, 'Sparse', {method: null, url: null, params: null, headers: null, bodyType: null, body: null}));
            respondWith('x');
            await create();

            await component.ensureResponse(ref(5), [], []);

            expect(executeCalls()[0].body).toEqual({
                requestId: 5, name: 'Sparse', method: 'GET', url: '', params: [], headers: [], bodyType: 'none', body: ''
            });
        });

        it.each([
            ['the proxy reports failure', () => ({response: {success: false, error: 'boom'}})],
            ['the proxy sends no response', () => ({})],
            ['the request fails outright', () => { throw new TypeError('offline'); }]
        ])('warns when %s', async (_label, handler) => {
            api.on('POST /execute', handler);
            await create();
            const warnings: string[] = [];

            const result = await component.ensureResponse(ref(2), [], warnings);

            expect(result).toBeNull();
            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_runfail {"name":"Source"}']);
            expect(window.sessionStorage.getItem('aaxis.api.resp.2')).toBeNull();
        });

        it("resolves the source request's own references first, depth-first", async () => {
            api.nodes.push(request(4, 'Chain', {url: 'http://x/chain/' + tokenOf(ref(2, {q: 'id'}))}));
            api.on('POST /execute', body => ({response: {
                success: true, status: 200, contentType: 'application/json', headers: [],
                body: body.requestId === 2 ? '{"id":"42"}' : '{"chained":true}'
            }}));
            await create();

            const result = await component.ensureResponse(ref(4), [], []);

            expect(executeCalls().map(c => [c.body.requestId, c.body.url]))
                .toEqual([[2, 'http://x/source'], [4, 'http://x/chain/42']]);
            expect(result.body).toBe('{"chained":true}');
        });

        it('breaks a cycle: the self-reference resolves to nothing and warns, the request still runs once', async () => {
            api.nodes.push(request(4, 'Loop', {url: 'http://x/loop/' + tokenOf(ref(4, {q: 'id', run: 'always'}))}));
            respondWith('{}');
            await create();
            const warnings: string[] = [];

            const result = await component.ensureResponse(ref(4, {run: 'always'}), [], warnings);

            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_cycle {"name":"Loop"}']);
            expect(executeCalls()).toHaveLength(1);
            expect(executeCalls()[0].body.url).toBe('http://x/loop/');
            expect(result.body).toBe('{}');
        });

        it('falls back to the cached response when a cycle is detected', async () => {
            store(2, 'cached');
            await create();
            const warnings: string[] = [];

            const result = await component.ensureResponse(ref(2, {run: 'always'}), [2], warnings);

            expect(result.body).toBe('cached');
            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_cycle {"name":"Source"}']);
            expect(executeCalls()).toHaveLength(0);
        });

        it('stops auto-running chains deeper than five requests', async () => {
            await create();
            const warnings: string[] = [];

            const result = await component.ensureResponse(ref(2), [11, 12, 13, 14, 15], warnings);

            expect(result).toBeNull();
            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_cycle {"name":"Source"}']);
            expect(executeCalls()).toHaveLength(0);
        });

        it('carries the warnings of a chained resolution up to the caller, without duplicates', async () => {
            api.nodes.push(request(4, 'Chain', {url: '{{res:AAAA}}', body: '{{res:AAAA}}', bodyType: 'raw'}));
            respondWith('ok');
            await create();
            const warnings: string[] = [];

            await component.ensureResponse(ref(4), [], warnings);

            expect(warnings).toEqual(['aaxis.tools.api_collection.ref_warn_invalid']);
        });
    });

    describe('extracting a value', () => {
        const extract = (body: string, def: Record<string, unknown>, headers: Array<{key: string; value: string}> = []): [string, string[]] => {
            const warnings: string[] = [];
            const value = component.extractValue(stored(body, {headers}), {run: 'ifEmpty', src: 'body', r: 2, ...def}, warnings);
            return [value, warnings];
        };

        beforeEach(async () => {
            await create();
        });

        it('returns the whole body when there is no filter', () => {
            expect(extract('  raw body ', {})).toEqual(['  raw body ', []]);
            expect(extract('raw', {q: '   '})).toEqual(['raw', []]);
        });

        it('reads a header case-insensitively, joining repeated headers', () => {
            const headers = [{key: 'Set-Cookie', value: 'a=1'}, {key: 'X-Other', value: 'z'}, {key: 'set-cookie', value: 'b=2'}];

            expect(extract('', {src: 'header', h: 'SET-COOKIE'}, headers)).toEqual(['a=1, b=2', []]);
        });

        it('warns about a header the response does not have', () => {
            expect(extract('', {src: 'header', h: 'X-Nope'})).toEqual(
                ['', ['aaxis.tools.api_collection.ref_warn_noheader {"name":"X-Nope"}']]);
            expect(extract('', {src: 'header'})).toEqual(
                ['', ['aaxis.tools.api_collection.ref_warn_noheader {"name":""}']]);
        });

        it('tolerates a stored response without a header list', () => {
            const warnings: string[] = [];

            const value = component.extractValue({...stored(''), headers: undefined}, {r: 2, src: 'header', h: 'X', run: 'none'}, warnings);

            expect(value).toBe('');
            expect(warnings).toHaveLength(1);
        });

        describe('JSONPath', () => {
            const doc = JSON.stringify({
                data: {token: 'abc', n: 5, ok: true, nul: null, obj: {k: 'v'}, 'b c': 'spaced',
                    list: [{id: 1, name: 'a'}, {id: 2, name: 'b'}, {id: 3}]},
                items: [10, 20, 30]
            });

            it.each([
                ['$.data.token', 'abc'],
                ['data.token', 'abc'],
                ['  $.data.token  ', 'abc'],
                ['$.data.n', '5'],
                ['$.data.ok', 'true'],
                ['$.data.obj', '{"k":"v"}'],
                ['$.data.list[0].name', 'a'],
                ['$.data.list[-1].id', '3'],
                ['$.data.list[-3].id', '1'],
                ['$.data.list[3]', ''],
                ['$.data.list[-4]', ''],
                ['$.data.list[*].id', '1, 2, 3'],
                ['$.data.list[*].name', 'a, b'],
                ['$.items[*]', '10, 20, 30'],
                ['$.items[ 1 ]', '20'],
                ['$..id', '1, 2, 3'],
                ['$..name', 'a, b'],
                ['$.data[*]', 'abc, 5, true, {"k":"v"}, spaced, [{"id":1,"name":"a"},{"id":2,"name":"b"},{"id":3}]'],
                ["$.data['b c']", 'spaced'],
                ['$.data["b c"]', 'spaced'],
                ['$.data[token]', 'abc'],
                ['$.data.nul', ''],
                ['$.data.missing', ''],
                ['$.items.foo', ''],
                ['$.data.token[0]', ''],
                ['$.data.token[*]', ''],
                ['$.data.token.x', ''],
                ['$.data.list[', '[{"id":1,"name":"a"},{"id":2,"name":"b"},{"id":3}]'],
                ['$.data@token', 'abc'],
                ['$.data.list[0]..id', '1']
            ])('%s -> %j', (query, expected) => {
                expect(extract(doc, {q: query})).toEqual([expected, []]);
            });

            it('warns when the body is not JSON', () => {
                expect(extract('<html>', {q: '$.a'})).toEqual(['', ['aaxis.tools.api_collection.ref_warn_json']]);
            });

            it('accepts the root selector alone', () => {
                expect(extract('[1,2]', {q: '$'})).toEqual(['[1,2]', []]);
            });
        });

        describe('XPath', () => {
            const xml = '<root><item id="a">One</item><item id="b">Two</item><n>3</n></root>';

            it('joins the text of matching nodes', () => {
                expect(extract(xml, {q: '/root/item'})).toEqual(['One, Two', []]);
            });

            it('reads attribute values', () => {
                expect(extract(xml, {q: '/root/item/@id'})).toEqual(['a, b', []]);
            });

            it('returns nothing (no warning) for an expression that matches no node', () => {
                expect(extract(xml, {q: '/root/nothing'})).toEqual(['', []]);
            });

            it.each([
                ['/root/n + 1', '4'],
                ['/root/n = 3', 'true'],
                ['/root/n = 4', 'false']
            ])('evaluates the scalar expression %s', (query, expected) => {
                expect(extract(xml, {q: query})).toEqual([expected, []]);
            });

            it.each([
                ['count(/root/item)', '2'],
                ['string(/root/item[2])', 'Two'],
                ['boolean(/root/n)', 'true']
            ])('evaluates %s to a single scalar', (query, expected) => {
                expect(component.xpathQuery(xml, query)).toEqual([expected]);
            });

            it('warns when the body is not well-formed XML', () => {
                expect(extract('{"json": true}', {q: '/root'})).toEqual(['', ['aaxis.tools.api_collection.ref_warn_xml']]);
            });

            it('warns when the expression is invalid', () => {
                expect(extract(xml, {q: '/root/[['})).toEqual(['', ['aaxis.tools.api_collection.ref_warn_xml']]);
            });
        });
    });

    describe('typing ### in a field', () => {
        const typeTrigger = (selector: string, value: string, caret: number = value.length): HTMLInputElement => {
            const input = $root.find(selector)[0] as HTMLInputElement;
            input.value = value;
            input.setSelectionRange(caret, caret);
            $(input).trigger('input');
            return input;
        };
        const paramValue = (): HTMLInputElement => {
            role('add-param').trigger('click');
            return role('params-rows').find('.aaxis-api__kv-value').last()[0];
        };

        beforeEach(async () => {
            await create();
            label(3).trigger('click');
            await flush();
        });

        it('removes the trigger from the URL and opens the popup', () => {
            const input = typeTrigger('[data-role="url"]', 'http://x/###');

            expect(input.value).toBe('http://x/');
            expect(lastModal().options.title).toBe('aaxis.tools.api_collection.ref_title');
            expect(lastModal().open).toHaveBeenCalled();
        });

        it('inserts the encoded token at the caret when confirmed, keeping the surrounding text', () => {
            const input = typeTrigger('[data-role="url"]', 'http://x/###/tail', 'http://x/###'.length);
            const modal: any = lastModal();
            modal.$el.find('[data-role="ref-request"]').val('2');
            modal.$el.find('[data-role="ref-filter"]').val(' $.id ');
            component.dirty = false;

            modal.emit('ok');

            const token = /\{\{res:[^}]+\}\}/.exec(input.value)![0];
            expect(input.value).toBe('http://x/' + token + '/tail');
            expect(payloadOf(token)).toEqual({r: 2, src: 'body', run: 'ifEmpty', q: '$.id'});
            expect(input.selectionStart).toBe(('http://x/' + token).length);
            expect(modal.close).toHaveBeenCalled();
            expect(component.dirty).toBe(true);
        });

        it.each([
            ['a parameter value', () => paramValue()],
            ['a header value', () => {
                role('add-header').trigger('click');
                return role('headers-rows').find('.aaxis-api__kv-value').last()[0];
            }]
        ])('also works in %s', (_label, field) => {
            const input = field();
            input.value = 'x###';
            input.setSelectionRange(4, 4);
            $(input).trigger('input');

            expect(input.value).toBe('x');
            expect(lastModal().open).toHaveBeenCalled();
        });

        it('ignores other input, including ### typed in a name field or elsewhere in the text', () => {
            typeTrigger('[data-role="url"]', 'http://x/##');
            typeTrigger('[data-role="url"]', '###abc', 6);
            role('add-param').trigger('click');
            const key = role('params-rows').find('.aaxis-api__kv-key').last()[0] as HTMLInputElement;
            key.value = '###';
            key.setSelectionRange(3, 3);
            $(key).trigger('input');

            expect(lastModal()).toBeUndefined();
        });
    });

    describe('editing a token in a field', () => {
        const click = (selector: string, value: string, caret: number): HTMLInputElement => {
            const input = $root.find(selector)[0] as HTMLInputElement;
            input.value = value;
            input.setSelectionRange(caret, caret);
            $(input).trigger('click');
            return input;
        };
        const token = tokenOf(ref(2, {q: '$.a', run: 'none'}));
        const other = tokenOf(ref(1, {src: 'header', h: 'Location'}));

        beforeEach(async () => {
            await create();
            label(3).trigger('click');
            await flush();
        });

        it('reopens the popup, prefilled, when the caret is inside a token', () => {
            click('[data-role="url"]', 'a' + token + 'b', 10);

            const form = lastModal().$el;
            expect(lastModal().options.okText).toBe('aaxis.tools.api_collection.ref_update');
            expect(form.find('[data-role="ref-request"]').val()).toBe('2');
            expect(form.find('[data-role="ref-filter"]').val()).toBe('$.a');
            expect(form.find('[data-role="ref-run"]').val()).toBe('none');
        });

        it('treats the token boundaries as inside', () => {
            click('[data-role="url"]', 'a' + token + 'b', 1);
            expect(Modal.instances).toHaveLength(1);
            click('[data-role="url"]', 'a' + token + 'b', 1 + token.length);
            expect(Modal.instances).toHaveLength(2);
        });

        it('replaces just that token with the updated one', () => {
            const value = 'pre' + other + '/' + token + '/post';
            const input = click('[data-role="url"]', value, 3 + other.length + 1 + 4);
            const modal: any = lastModal();
            modal.$el.find('[data-role="ref-run"]').val('always');

            modal.emit('ok');

            const updated = /\{\{res:[^}]+\}\}/g;
            const tokens = input.value.match(updated)!;
            expect(tokens[0]).toBe(other);
            expect(payloadOf(tokens[1])).toEqual({r: 2, src: 'body', run: 'always', q: '$.a'});
            expect(input.value.startsWith('pre' + other + '/')).toBe(true);
            expect(input.value.endsWith('/post')).toBe(true);
        });

        it('does nothing when the caret is outside every token or the field has none', () => {
            click('[data-role="url"]', 'a' + token + 'b', 0);
            click('[data-role="url"]', 'plain text', 3);
            click('[data-role="url"]', 'a' + token + 'bcd' + other, 1 + token.length + 2);

            expect(Modal.instances).toHaveLength(0);
        });

        it('does nothing for a token that cannot be decoded', () => {
            click('[data-role="url"]', 'x{{res:AAAA}}y', 5);

            expect(Modal.instances).toHaveLength(0);
        });

        it('does nothing when the input has no caret', () => {
            component.editInputTokenAtCaret({value: token, selectionStart: null});

            expect(Modal.instances).toHaveLength(0);
        });
    });

    describe('references in the body editor', () => {
        const editor = (): any => component.bodyEditor;

        beforeEach(async () => {
            await create();
            label(3).trigger('click');
            await flush();
            editor().setValue('');
            component.dirty = false;
        });

        it('opens the popup when ### is typed and removes the trigger text', () => {
            editor().setValue('{"a": ###');
            editor().emit('keyup', {key: '#'});

            expect(editor().getValue()).toBe('{"a": ');
            expect(lastModal().options.title).toBe('aaxis.tools.api_collection.ref_title');
        });

        it('inserts the token at the caret when confirmed and marks the request edited', () => {
            editor().setValue('one\nab###cd');
            editor().cursor = {line: 1, ch: 5};
            editor().emit('keyup', {key: '#'});
            expect(editor().getValue()).toBe('one\nabcd');
            editor().cursor = {line: 1, ch: 2};
            component.dirty = false;
            const modal: any = lastModal();
            modal.$el.find('[data-role="ref-request"]').val('1');

            modal.emit('ok');

            const token = /\{\{res:[^}]+\}\}/.exec(editor().getValue())![0];
            expect(editor().getValue()).toBe('one\nab' + token + 'cd');
            expect(payloadOf(token)).toMatchObject({r: 1, src: 'body'});
            expect(editor().focus).toHaveBeenCalled();
            expect(component.dirty).toBe(true);
        });

        it.each([
            ['another key', 'ab###', {key: 'a'}],
            ['# without the full trigger', 'ab##', {key: '#'}]
        ])('ignores %s', (_label, text, event) => {
            editor().setValue(text);

            editor().emit('keyup', event);

            expect(editor().getValue()).toBe(text);
            expect(lastModal()).toBeUndefined();
        });

        describe('chips', () => {
            const chipTexts = (): string[] => editor().markText.mock.calls.map((c: any[]) => c[2].replacedWith.textContent);

            it('renders each token as a chip naming the source request and what is taken from it', () => {
                editor().setValue([
                    'A ' + tokenOf(ref(2, {q: '$.token'})),
                    'B ' + tokenOf(ref(1, {src: 'header', h: 'Location'})),
                    'C ' + tokenOf(ref(2)),
                    'D ' + tokenOf(ref(1, {src: 'header'})),
                    'E ' + tokenOf(ref(99))
                ].join('\n'));
                editor().markText.mockClear();

                component.decorateBody();

                expect(chipTexts()).toEqual([
                    '↪ Source · $.token', '↪ Login · Location', '↪ Source · body', '↪ Login · header', '↪ #99 · body'
                ]);
                const [from, to, options] = editor().markText.mock.calls[0];
                expect(from).toEqual({line: 0, ch: 2});
                expect(to.line).toBe(0);
                expect(options.atomic).toBe(true);
                expect(options.replacedWith.className).toBe('aaxis-api__ref-chip');
                expect(options.replacedWith.title).toBe('aaxis.tools.api_collection.ref_edit');
            });

            it('skips undecodable tokens and does nothing for text without tokens', () => {
                editor().setValue('x {{res:AAAA}} y');
                editor().markText.mockClear();
                component.decorateBody();
                expect(editor().markText).not.toHaveBeenCalled();

                editor().setValue('nothing here');
                component.decorateBody();
                expect(editor().markText).not.toHaveBeenCalled();
            });

            it('replaces its own marks on every pass and leaves foreign marks alone', () => {
                editor().setValue('A ' + tokenOf(ref(2)));
                editor().markText.mockClear();
                component.decorateBody();
                const foreign = editor().markText({line: 0, ch: 0}, {line: 0, ch: 1}, {});
                const ours = editor().getAllMarks().find((m: any) => m.__aaxisRef);
                expect(ours).toBeDefined();

                component.decorateBody();

                expect(ours.clear).toHaveBeenCalledTimes(1);
                expect(foreign.clear).not.toHaveBeenCalled();
                expect(editor().getAllMarks().filter((m: any) => m.__aaxisRef)).toHaveLength(1);
            });

            it('re-decorates when a request is loaded', () => {
                api.nodes[1].body = 'X ' + tokenOf(ref(2));
                component.nodes = api.nodes;
                editor().markText.mockClear();

                component.loadRequest(api.nodes[1]);

                expect(chipTexts()).toEqual(['↪ Source · body']);
            });

            it('reopens the popup, prefilled, when a chip is clicked, and swaps the token on confirm', () => {
                const original = tokenOf(ref(2, {q: '$.a', run: 'always'}));
                editor().setValue('pre ' + original + ' post');
                component.decorateBody();
                const chip: HTMLElement = editor().markText.mock.calls.at(-1)[2].replacedWith;
                const event = new MouseEvent('mousedown', {cancelable: true, bubbles: true});
                const stop = vi.spyOn(event, 'stopPropagation');

                chip.dispatchEvent(event);

                expect(event.defaultPrevented).toBe(true);
                expect(stop).toHaveBeenCalled();
                const modal: any = lastModal();
                expect(modal.options.okText).toBe('aaxis.tools.api_collection.ref_update');
                expect(modal.$el.find('[data-role="ref-filter"]').val()).toBe('$.a');
                modal.$el.find('[data-role="ref-filter"]').val('$.b');
                component.dirty = false;
                editor().markText.mockClear();

                modal.emit('ok');
                vi.advanceTimersByTime(20);

                const replaced = /\{\{res:[^}]+\}\}/.exec(editor().getValue())![0];
                expect(editor().getValue()).toBe('pre ' + replaced + ' post');
                expect(payloadOf(replaced)).toEqual({r: 2, src: 'body', run: 'always', q: '$.b'});
                expect(component.dirty).toBe(true);
                expect(editor().markText).toHaveBeenCalled();
            });

            it('does nothing when the marked range has been removed from the document', () => {
                editor().setValue('pre ' + tokenOf(ref(2)));
                component.decorateBody();
                editor().getAllMarks().find((m: any) => m.__aaxisRef).find.mockReturnValue(null);
                const chip: HTMLElement = editor().markText.mock.calls.at(-1)[2].replacedWith;

                chip.dispatchEvent(new MouseEvent('mousedown', {cancelable: true}));

                expect(lastModal()).toBeUndefined();
            });
        });
    });

    describe('reference popup', () => {
        const open = (preset?: Record<string, unknown>): {insert: any; modal: any; form: any} => {
            const insert = vi.fn();
            component.openRefPopup(insert, preset);
            const modal: any = lastModal();
            return {insert, modal, form: modal.$el.find('.modal-body .aaxis-api__ref-form')};
        };
        const field = (form: any, name: string): any => form.find(`[data-role="${name}"]`);

        beforeEach(async () => {
            await create();
            label(3).trigger('click');
            await flush();
        });

        it('is a dialog with an Insert button, whose body holds the form', () => {
            const {modal, form} = open();

            expect(modal.options).toMatchObject({
                title: 'aaxis.tools.api_collection.ref_title',
                okText: 'aaxis.tools.api_collection.ref_insert',
                okCloses: false,
                cancelText: 'Close'
            });
            expect(modal.open).toHaveBeenCalledTimes(1);
            expect(form).toHaveLength(1);
        });

        it('lists the other requests by "METHOD · Folder / Name", never the open request or folders', () => {
            const {form} = open();

            expect(field(form, 'ref-request').find('option').toArray().map((o: any) => [o.value, o.textContent]))
                .toEqual([['1', 'POST · Auth / Login'], ['2', 'GET · Source']]);
        });

        it('shows a note when there is no other request', () => {
            component.nodes = component.nodes.filter((n: any) => n.id === 3);

            const {form} = open();

            expect(form.find('.aaxis-api__ref-note').text()).toBe('aaxis.tools.api_collection.ref_no_request');
        });

        it('offers body/header sources and the three auto-run policies', () => {
            const {form} = open();

            expect(field(form, 'ref-attr').find('option').toArray().map((o: any) => o.value)).toEqual(['body', 'header']);
            expect(field(form, 'ref-run').find('option').toArray().map((o: any) => o.value)).toEqual(['ifEmpty', 'none', 'always']);
            expect(field(form, 'ref-run').val()).toBe('ifEmpty');
        });

        it('shows the filter for a body source and the header name for a header source', () => {
            const {form} = open();
            const rowOf = (name: string): any => field(form, name).closest('.aaxis-api__ref-row');

            expect(rowOf('ref-header').prop('hidden')).toBe(true);
            expect(rowOf('ref-filter').prop('hidden')).toBe(false);

            field(form, 'ref-attr').val('header').trigger('change');
            expect(rowOf('ref-header').prop('hidden')).toBe(false);
            expect(rowOf('ref-filter').prop('hidden')).toBe(true);
        });

        it('prefills the form when editing an existing reference', () => {
            const {modal, form} = open({r: 1, src: 'header', h: 'Location', q: undefined, run: 'always'});

            expect(modal.options.okText).toBe('aaxis.tools.api_collection.ref_update');
            expect(field(form, 'ref-request').val()).toBe('1');
            expect(field(form, 'ref-attr').val()).toBe('header');
            expect(field(form, 'ref-header').val()).toBe('Location');
            expect(field(form, 'ref-filter').val()).toBe('');
            expect(field(form, 'ref-run').val()).toBe('always');
            expect(field(form, 'ref-header').closest('.aaxis-api__ref-row').prop('hidden')).toBe(false);
        });

        it('inserts a body reference built from the form', () => {
            const {insert, modal, form} = open();
            field(form, 'ref-request').val('2');
            field(form, 'ref-filter').val('  $.data.id ');
            field(form, 'ref-run').val('none');

            modal.emit('ok');

            expect(insert).toHaveBeenCalledTimes(1);
            expect(payloadOf(insert.mock.calls[0][0])).toEqual({r: 2, src: 'body', run: 'none', q: '$.data.id'});
            expect(modal.close).toHaveBeenCalledTimes(1);
        });

        it('inserts a header reference with a trimmed header name and no filter', () => {
            const {insert, modal, form} = open();
            field(form, 'ref-request').val('1');
            field(form, 'ref-attr').val('header').trigger('change');
            field(form, 'ref-header').val(' Location ');
            field(form, 'ref-filter').val('$.ignored');

            modal.emit('ok');

            expect(payloadOf(insert.mock.calls[0][0])).toEqual({r: 1, src: 'header', run: 'ifEmpty', h: 'Location'});
        });

        it('refuses to insert when there is no request to reference', () => {
            component.nodes = component.nodes.filter((n: any) => n.id === 3);
            const {insert, modal} = open();

            modal.emit('ok');

            expect(insert).not.toHaveBeenCalled();
            expect(modal.close).not.toHaveBeenCalled();
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('warning', 'aaxis.tools.api_collection.ref_no_request');
        });

        describe('preview', () => {
            const preview = async (form: any): Promise<string> => {
                field(form, 'ref-preview-btn').trigger('click');
                await flush();
                return field(form, 'ref-preview').text();
            };

            it('shows the value the reference would resolve to', async () => {
                store(2, '{"data":{"id":"77"}}');
                const {form} = open();
                field(form, 'ref-request').val('2');
                field(form, 'ref-filter').val('$.data.id');

                expect(await preview(form)).toBe('77');
            });

            it('says "sending" while the source request runs', async () => {
                let release: (v: unknown) => void = () => undefined;
                api.on('POST /execute', () => new Promise(resolve => { release = resolve; }));
                const {form} = open();
                field(form, 'ref-request').val('2');

                field(form, 'ref-preview-btn').trigger('click');
                await flush();
                expect(field(form, 'ref-preview').text()).toBe('aaxis.tools.api_collection.sending');

                release({response: {success: true, status: 200, body: 'done', headers: [], contentType: ''}});
                await flush();
                expect(field(form, 'ref-preview').text()).toBe('done');
            });

            it('shows the warnings when nothing could be extracted', async () => {
                const {form} = open();
                field(form, 'ref-request').val('2');
                field(form, 'ref-run').val('none');

                expect(await preview(form)).toBe('aaxis.tools.api_collection.ref_warn_nostored {"name":"Source"}');
            });

            it('says the result is empty when there is nothing to show and nothing to warn about', async () => {
                store(2, '');
                const {form} = open();
                field(form, 'ref-request').val('2');

                expect(await preview(form)).toBe('aaxis.tools.api_collection.ref_preview_empty');
            });

            it('does nothing without a request to reference', async () => {
                component.nodes = component.nodes.filter((n: any) => n.id === 3);
                const {form} = open();

                expect(await preview(form)).toBe('');
            });
        });

        describe('searchable selects', () => {
            it('enhances the request, source and auto-run selects inside the dialog', () => {
                const {modal, form} = open();

                const instances: any[] = (Select2View as any).instances;
                expect(instances).toHaveLength(3);
                expect(instances[0].options.el[0]).toBe(field(form, 'ref-request')[0]);
                expect(instances[0].options.select2Config).toEqual({width: '100%', dropdownParent: modal.$el});
                expect(instances[1].options.el[0]).toBe(field(form, 'ref-attr')[0]);
                expect(instances[1].options.select2Config)
                    .toEqual({width: '100%', minimumResultsForSearch: Infinity, dropdownParent: modal.$el});
                expect(instances[2].options.el[0]).toBe(field(form, 'ref-run')[0]);
            });

            it('disposes them when the dialog is hidden', () => {
                const {modal} = open();
                const instances: any[] = (Select2View as any).instances;

                modal.emit('hidden');

                instances.forEach(instance => expect(instance.dispose).toHaveBeenCalledTimes(1));
            });

            it('keeps the native selects when Select2 cannot start', () => {
                (Select2View as any).throwOnCreate = true;

                const {modal, form} = open();

                expect((Select2View as any).instances).toHaveLength(0);
                expect(() => modal.emit('hidden')).not.toThrow();
                expect(field(form, 'ref-request').find('option')).toHaveLength(2);
            });
        });
    });
});
