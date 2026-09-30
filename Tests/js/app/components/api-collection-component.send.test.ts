import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import CodeMirror from 'codemirror';
import messenger from 'oroui/js/messenger';
import {FakeApi, MARKUP, createComponent, flush, request} from './support/api-collection';

vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

/** A successful proxy answer, as the execute endpoint returns it. */
function executed(overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): any {
    return {
        response: {
            success: true, status: 200, statusText: 'OK',
            headers: [{key: 'Content-Type', value: 'application/json'}, {key: 'X-Rate', value: '9'}],
            body: '{"ok":true,"n":[1,2]}', contentType: 'application/json; charset=utf-8', timeMs: 15, size: 21,
            ...overrides
        },
        ...extra
    };
}

const stored = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
    status: 200, statusText: 'OK', contentType: 'text/plain', body: 'cached body',
    headers: [{key: 'X-Cached', value: 'yes'}], timeMs: 3, size: 11, at: '2026-01-01T00:00:00.000Z', ...overrides
});

describe('ApiCollectionComponent: sending requests and showing responses', () => {
    let $root: any;
    let component: any;
    let api: FakeApi;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const label = (id: number): any => role('tree').find(`[data-role="node-label"][data-id="${id}"]`);
    const create = async (): Promise<any> => {
        component = await createComponent($root, api);
        return component;
    };
    const open = async (id: number): Promise<void> => {
        label(id).trigger('click');
        await flush();
    };
    const send = async (): Promise<void> => {
        role('send').trigger('click');
        await flush();
    };
    const runMode = (): any => (CodeMirror as any).runMode;
    const executeCalls = (): any[] => api.callsTo('POST', '/execute');

    beforeEach(() => {
        vi.useFakeTimers();
        runMode().mockReset();
        $root = $(MARKUP).appendTo(document.body);
        api = new FakeApi();
        api.nodes = [
            request(1, 'Login', {method: 'POST', url: 'http://x/login', bodyType: 'json', body: '{"u":1}',
                params: [{key: 'q', value: '1'}], headers: [{key: 'X-A', value: 'b'}]}),
            request(2, 'Other', {url: 'http://x/other'})
        ];
        api.on('POST /execute', () => executed());
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        window.sessionStorage.clear();
    });

    describe('sending', () => {
        it('posts the collected request to the proxy and renders the response', async () => {
            await create();
            await open(1);

            await send();

            expect(executeCalls()).toHaveLength(1);
            expect(executeCalls()[0].body).toEqual({
                requestId: 1, name: 'Login', method: 'POST', url: 'http://x/login',
                params: [{key: 'q', value: '1'}], headers: [{key: 'X-A', value: 'b'}],
                bodyType: 'json', body: '{"u":1}'
            });
            expect(role('result').find('.aaxis-api__status').text()).toBe('200 OK');
            expect(role('result').find('.aaxis-api__status').hasClass('is-2xx')).toBe(true);
            expect(role('result').find('.aaxis-api__res-stat').toArray().map((el: any) => el.textContent)).toEqual(['15 ms', '21 B']);
            expect(role('result').find('.aaxis-api__res-cached')).toHaveLength(0);
        });

        it('shows a sending note and a spinner while in flight, then restores the button', async () => {
            let release: (value: unknown) => void = () => undefined;
            api.on('POST /execute', () => new Promise(resolve => { release = resolve; }));
            await create();
            await open(1);

            role('send').trigger('click');
            await flush();

            expect(role('result').text()).toBe('aaxis.tools.api_collection.sending');
            expect(role('send').prop('disabled')).toBe(true);
            expect(role('send').find('.fa').attr('class')).toBe('fa fa-spinner fa-spin');

            release(executed());
            await flush();
            expect(role('send').prop('disabled')).toBe(false);
            expect(role('send').find('.fa').attr('class')).toBe('fa fa-paper-plane');
        });

        it('ignores another click while a request is running', async () => {
            let release: (value: unknown) => void = () => undefined;
            api.on('POST /execute', () => new Promise(resolve => { release = resolve; }));
            await create();
            await open(1);

            role('send').trigger('click');
            await flush();
            // The disabled button already swallows clicks; the guard also covers other callers.
            role('send').trigger('click');
            await component.onSend();
            await flush();
            expect(executeCalls()).toHaveLength(1);

            release(executed());
            await flush();
        });

        it('refuses to send without a URL', async () => {
            await create();
            await open(2);
            role('url').val('   ');

            await send();

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('warning', 'aaxis.tools.api_collection.url_required');
            expect(executeCalls()).toHaveLength(0);
            expect(component.running).toBe(false);
        });

        it('saves an edited request first (silently), then sends the edited values', async () => {
            await create();
            await open(1);
            role('url').val('http://x/edited').trigger('input');

            await send();

            const order = api.calls.map(c => c.method + ' ' + c.url);
            expect(order.indexOf('PUT /nodes/1')).toBeGreaterThan(-1);
            expect(order.indexOf('PUT /nodes/1')).toBeLessThan(order.indexOf('POST /execute'));
            expect(executeCalls()[0].body.url).toBe('http://x/edited');
            expect(messenger.notificationFlashMessage).not.toHaveBeenCalled();
        });

        it('can send an ad-hoc request that is not part of the collection', async () => {
            await create();
            role('url').val('http://x/adhoc');

            await send();

            expect(executeCalls()[0].body).toMatchObject({requestId: null, name: null, url: 'http://x/adhoc', method: 'GET'});
            expect(window.sessionStorage).toHaveLength(0);
        });

        it('replaces the run history with the one the server returns', async () => {
            api.on('POST /execute', () => executed({}, {runs: [
                {id: 9, name: 'Login', method: 'POST', url: 'http://x/login', status: 200, result: 'ok', sizeBytes: 5, timeMs: 1, runAt: null}
            ]}));
            await create();
            await open(1);

            await send();

            expect(role('runs').find('.aaxis-api__run')).toHaveLength(1);
        });

        it('caches the response for the session under the request id', async () => {
            vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'));
            await create();
            await open(1);

            await send();

            expect(JSON.parse(window.sessionStorage.getItem('aaxis.api.resp.1')!)).toEqual({
                status: 200, statusText: 'OK', contentType: 'application/json; charset=utf-8',
                body: '{"ok":true,"n":[1,2]}', timeMs: 15, size: 21, at: '2026-03-04T05:06:07.000Z',
                headers: [{key: 'Content-Type', value: 'application/json'}, {key: 'X-Rate', value: '9'}]
            });
        });

        it('still shows the response when the session cache is unavailable', async () => {
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
            await create();
            await open(1);

            await send();

            expect(role('result').find('.aaxis-api__status').text()).toBe('200 OK');
        });

        it('fills in defaults for a sparse response', async () => {
            api.on('POST /execute', () => ({response: {success: true, status: 204}}));
            await create();
            await open(1);

            await send();

            expect(component.lastResponse).toEqual({
                status: 204, statusText: '', headers: [], body: '', contentType: '', timeMs: 0, size: 0
            });
        });

        it('reports a failed proxy call with the server reason', async () => {
            api.on('POST /execute', () => ({response: {success: false, error: 'Connection timed out'}}));
            await create();
            await open(1);

            await send();

            expect(role('result').find('.alert.alert-error').text())
                .toBe('aaxis.tools.api_collection.fetch_error Connection timed out');
            expect(component.lastResponse).toBeNull();
            expect(component.running).toBe(false);
        });

        it('reports a failed proxy call without a reason, and an empty answer', async () => {
            api.on('POST /execute', () => ({}));
            await create();
            await open(1);

            await send();

            expect(role('result').find('.alert.alert-error').text()).toBe('aaxis.tools.api_collection.fetch_error ');
        });

        it('reports a network failure and re-enables the button', async () => {
            api.on('POST /execute', () => { throw new TypeError('network down'); });
            await create();
            await open(1);

            await send();

            expect(role('result').find('.alert.alert-error').text()).toBe('aaxis.tools.api_collection.error');
            expect(component.lastResponse).toBeNull();
            expect(role('send').prop('disabled')).toBe(false);
        });

        it('warns about unresolvable references but still sends the request', async () => {
            await create();
            await open(1);
            role('url').val('http://x/{{res:AAAA}}');

            await send();

            expect(messenger.notificationFlashMessage)
                .toHaveBeenCalledWith('warning', 'aaxis.tools.api_collection.ref_warn_invalid');
            expect(executeCalls()[0].body.url).toBe('http://x/');
        });

        it('substitutes referenced values into what is sent, while keeping the saved form untouched', async () => {
            window.sessionStorage.setItem('aaxis.api.resp.2', JSON.stringify({status: 200, body: '{"id":"77"}'}));
            const token = '{{res:' + btoa(JSON.stringify({r: 2, src: 'body', q: '$.id', run: 'none'})) + '}}';
            await create();
            await open(1);
            role('url').val('http://x/items/' + token);

            await send();

            expect(executeCalls()[0].body.url).toBe('http://x/items/77');
            expect(role('url').val()).toBe('http://x/items/' + token);
        });

        it('sends the CSRF header taken from the cookie', async () => {
            document.cookie = '_csrf=abc%3D';
            await create();
            await open(1);

            await send();
            document.cookie = '_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';

            expect(executeCalls()[0].headers).toEqual({'Content-Type': 'application/json', 'X-CSRF-Header': 'abc='});
        });
    });

    describe('response viewer', () => {
        const show = (res: Record<string, unknown>, cached = false): void => {
            component.lastResponse = {
                status: 200, statusText: 'OK', headers: [], body: '', contentType: '', timeMs: 1, size: 1, ...res
            };
            component.lastResponseCached = cached;
            component.renderResult();
        };
        const body = (): HTMLElement => role('result').find('pre.aaxis-api__res-body')[0];

        it.each([
            [200, 'is-2xx'], [299, 'is-2xx'], [300, 'is-3xx'], [399, 'is-3xx'],
            [400, 'is-4xx'], [499, 'is-4xx'], [500, 'is-5xx'], [599, 'is-5xx']
        ])('classes status %i as %s', async (status, cssClass) => {
            await create();

            show({status});

            expect(role('result').find('.aaxis-api__status').attr('class')).toBe('aaxis-api__status ' + cssClass);
        });

        it.each([
            [0, '0 B'], [1023, '1023 B'], [1024, '1.0 KB'], [1536, '1.5 KB'],
            [1048575, '1024.0 KB'], [1048576, '1.0 MB'], [5 * 1048576 + 524288, '5.5 MB']
        ])('formats %i bytes as %s', async (size, text) => {
            await create();

            show({size});

            expect(role('result').find('.aaxis-api__res-stat').last().text()).toBe(text);
        });

        it('marks a response restored from the session', async () => {
            await create();

            show({}, true);

            expect(role('result').find('.aaxis-api__res-cached').text()).toBe('aaxis.tools.api_collection.cached_response');
        });

        it('renders nothing for an empty state', async () => {
            await create();
            component.lastResponse = null;

            component.renderResult();

            expect(role('result').children()).toHaveLength(0);
        });

        it('offers Headers and Body tabs, Body first', async () => {
            await create();

            show({});

            const tabs = role('result').find('.aaxis-api__res-tab');
            expect(tabs.toArray().map((t: any) => t.textContent)).toEqual([
                'aaxis.tools.api_collection.response_headers', 'aaxis.tools.api_collection.response_body'
            ]);
            expect(tabs.filter('.is-active').attr('data-restab')).toBe('body');
        });

        it('lists the response headers on the Headers tab and switches back', async () => {
            await create();
            show({headers: [{key: 'Content-Type', value: 'text/plain'}, {key: 'X-Id', value: '7'}]});

            role('result').find('[data-restab="headers"]').trigger('click');

            expect(role('result').find('.aaxis-api__res-headers > div').toArray().map((el: any) => el.textContent))
                .toEqual(['Content-Type: text/plain', 'X-Id: 7']);
            expect(role('result').find('.aaxis-api__res-tab.is-active').attr('data-restab')).toBe('headers');

            role('result').find('[data-restab="body"]').trigger('click');
            expect(role('result').find('pre.aaxis-api__res-body')).toHaveLength(1);
        });

        it('pretty-prints and highlights JSON', async () => {
            await create();

            show({contentType: 'application/json', body: '{"a":1,"b":[2]}'});

            expect(runMode()).toHaveBeenCalledWith(
                '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}', {name: 'javascript', json: true}, body());
            expect(body().className).toBe('cm-s-default aaxis-api__res-body');
        });

        it('keeps malformed JSON as received', async () => {
            await create();

            show({contentType: 'application/json', body: '{broken'});

            expect(runMode()).toHaveBeenCalledWith('{broken', {name: 'javascript', json: true}, body());
        });

        it('highlights HTML without reformatting it', async () => {
            await create();

            show({contentType: 'text/html; charset=UTF-8', body: '<p>hi</p>'});

            expect(runMode()).toHaveBeenCalledWith('<p>hi</p>', 'htmlmixed', body());
        });

        it('indents and highlights XML', async () => {
            await create();

            show({contentType: 'application/xml', body: '<root><item>1</item></root>'});

            expect(runMode()).toHaveBeenCalledWith('<root>\n  <item>1</item>\n</root>', 'xml', body());
        });

        it('shows other content types as plain text, without highlighting', async () => {
            await create();

            show({contentType: 'text/plain', body: 'just <text>'});

            expect(runMode()).not.toHaveBeenCalled();
            expect(body().textContent).toBe('just <text>');
        });

        it('lets the highlighter fill the block', async () => {
            runMode().mockImplementation((text: string, _mode: unknown, el: HTMLElement) => {
                el.innerHTML = '<span class="cm-atom">' + text + '</span>';
            });
            await create();

            show({contentType: 'application/json', body: 'true'});

            expect(body().querySelector('.cm-atom')?.textContent).toBe('true');
        });

        it('falls back to unhighlighted text when the highlighter fails', async () => {
            runMode().mockImplementation(() => { throw new Error('mode missing'); });
            await create();

            show({contentType: 'application/json', body: '{"a":1}'});

            expect(body().textContent).toBe('{\n  "a": 1\n}');
        });

        it('keeps the raw body if reformatting XML fails', async () => {
            await create();

            expect(component.prettifyBody(123, {mode: 'xml'})).toBe(123);
            expect(component.prettifyBody('x', null)).toBe('x');
        });
    });

    describe('responses remembered for the session', () => {
        it('re-shows the cached response when a request is opened, flagged as cached', async () => {
            window.sessionStorage.setItem('aaxis.api.resp.2', stored());
            await create();

            await open(2);

            expect(component.lastResponseCached).toBe(true);
            expect(role('result').find('.aaxis-api__status').text()).toBe('200 OK');
            expect(role('result').find('.aaxis-api__res-cached')).toHaveLength(1);
            expect(role('result').find('pre.aaxis-api__res-body').text()).toBe('cached body');
        });

        it('fills defaults for an incomplete cache entry', async () => {
            window.sessionStorage.setItem('aaxis.api.resp.2', JSON.stringify({status: 418}));
            await create();

            await open(2);

            expect(component.lastResponse).toEqual({
                status: 418, statusText: '', headers: [], body: '', contentType: '', timeMs: 0, size: 0
            });
        });

        it('shows the empty state for a request without a cached response', async () => {
            await create();
            await open(1);
            await send();
            expect(role('result').find('.aaxis-api__status')).toHaveLength(1);

            await open(2);

            expect(component.lastResponse).toBeNull();
            expect(role('result').find('.aaxis-api__result-empty').text()).toBe('aaxis.tools.api_collection.no_response');
            expect(component.resultTab).toBe('body');
        });

        it('treats a corrupt cache entry as absent', async () => {
            window.sessionStorage.setItem('aaxis.api.resp.2', '{not json');
            await create();

            await open(2);

            expect(component.lastResponse).toBeNull();
        });

        it('treats unreadable session storage as absent', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
            await create();

            await open(2);

            expect(component.lastResponse).toBeNull();
        });
    });
});
