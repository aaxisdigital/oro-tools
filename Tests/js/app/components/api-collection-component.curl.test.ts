import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import {FakeApi, Failed, MARKUP, createComponent, flush, folder, lastModal, request} from './support/api-collection';

vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

describe('ApiCollectionComponent: cURL import and export', () => {
    let $root: any;
    let component: any;
    let api: FakeApi;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const create = async (): Promise<any> => {
        component = await createComponent($root, api);
        return component;
    };
    const menuAction = (id: number, action: string): void => {
        role('tree').find(`[data-role="node-menu"][data-id="${id}"]`).trigger('click');
        $(`.aaxis-api__menu a[data-action="${action}"]`).trigger('click');
    };

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        api = new FakeApi();
        api.nodes = [folder(10, 'Auth'), request(1, 'Login', {parentId: 10})];
        Modal.instances.length = 0;
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        Reflect.deleteProperty(navigator, 'clipboard');
    });

    describe('export', () => {
        const exportOf = async (node: Record<string, unknown>): Promise<string> => {
            api.nodes = [request(1, 'Exported', node)];
            await create();
            menuAction(1, 'export-curl');
            return String(lastModal().$el.find('textarea').text());
        };

        it('builds a curl command from the method, headers, body, URL and query parameters', async () => {
            const curl = await exportOf({
                method: 'POST', url: 'http://x/api', bodyType: 'json', body: '{"a":"it\'s"}',
                headers: [{key: 'Content-Type', value: 'application/json'}, {key: '', value: 'dropped'}],
                params: [{key: 'q', value: 'a b'}, {key: '', value: 'dropped'}, {key: 'k&', value: '1/2'}]
            });

            expect(curl).toBe(
                "curl -X POST -H 'Content-Type: application/json' --data '{\"a\":\"it'\\''s\"}' "
                + "'http://x/api?q=a%20b&k%26=1%2F2'");
        });

        it('appends the parameters with & when the URL already has a query', async () => {
            const curl = await exportOf({url: 'http://x/api?a=1', params: [{key: 'b', value: '2'}]});

            expect(curl).toBe("curl -X GET 'http://x/api?a=1&b=2'");
        });

        it.each(['GET', 'HEAD'])('leaves the body out of a %s request', async method => {
            const curl = await exportOf({method, url: 'http://x', body: 'ignored'});

            expect(curl).toBe(`curl -X ${method} 'http://x'`);
        });

        it('includes the body of other methods, but not an empty one', async () => {
            expect(await exportOf({method: 'DELETE', url: 'http://x', body: 'payload'}))
                .toBe("curl -X DELETE --data 'payload' 'http://x'");
            component.dispose();
            $root = $(MARKUP).appendTo(document.body);
            expect(await exportOf({method: 'POST', url: 'http://x', body: ''})).toBe("curl -X POST 'http://x'");
        });

        it('copes with a request that has nothing set', async () => {
            const curl = await exportOf({method: null, url: null, headers: null, params: null, body: null});

            expect(curl).toBe("curl -X GET ''");
        });

        it('shows the command in a read-only box inside a Copy/Close dialog', async () => {
            await exportOf({url: 'http://x'});

            const modal: any = lastModal();
            expect(modal.options).toMatchObject({
                title: 'aaxis.tools.api_collection.menu_export_curl',
                okText: 'aaxis.tools.api_collection.copy',
                cancelText: 'Close'
            });
            expect(modal.open).toHaveBeenCalled();
            expect(modal.$el.find('.modal-body textarea').attr('readonly')).toBe('readonly');
        });

        it('copies the command to the clipboard and closes on Copy', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
            await exportOf({url: 'http://x'});

            (lastModal() as any).emit('ok');

            expect(writeText).toHaveBeenCalledWith("curl -X GET 'http://x'");
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('success', 'aaxis.tools.api_collection.copied');
            expect(lastModal().close).toHaveBeenCalled();
        });

        it('still confirms and closes when there is no clipboard API', async () => {
            await exportOf({url: 'http://x'});

            (lastModal() as any).emit('ok');

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('success', 'aaxis.tools.api_collection.copied');
            expect(lastModal().close).toHaveBeenCalled();
        });

        it('quotes shell metacharacters safely', async () => {
            await create();

            expect(component.shellQuote("it's")).toBe("'it'\\''s'");
            expect(component.shellQuote('plain')).toBe("'plain'");
            expect(component.shellQuote('a b $HOME `x`')).toBe("'a b $HOME `x`'");
        });
    });

    describe('parsing a curl command', () => {
        beforeEach(async () => {
            await create();
        });

        const parse = (raw: string): any => component.parseCurl(raw);

        it('takes the first bare argument as the URL and defaults to GET', () => {
            expect(parse('curl https://x.test/a')).toEqual({method: 'GET', url: 'https://x.test/a', headers: [], body: ''});
        });

        it.each([
            ["curl -X post 'https://x/a'", 'POST'],
            ['curl --request put https://x/a', 'PUT'],
            ['curl https://x/a -X delete', 'DELETE']
        ])('reads the method from %s', (raw, method) => {
            expect(parse(raw).method).toBe(method);
        });

        it('reads --url and unquotes single- and double-quoted URLs', () => {
            expect(parse("curl --url 'https://x/a'").url).toBe('https://x/a');
            expect(parse('curl "https://x/b?q=1&r=2"').url).toBe('https://x/b?q=1&r=2');
        });

        it('collects headers, splitting at the first colon and trimming', () => {
            const parsed = parse(`curl -H 'Content-Type: application/json' --header "X-A:  b: c " https://x`);

            expect(parsed.headers).toEqual([
                {key: 'Content-Type', value: 'application/json'},
                {key: 'X-A', value: 'b: c'}
            ]);
        });

        it('ignores a header without a colon', () => {
            expect(parse("curl -H 'Broken' https://x").headers).toEqual([]);
        });

        it.each(['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'])('reads the body from %s and then defaults to POST', flag => {
            const parsed = parse(`curl ${flag} 'a=1' https://x`);

            expect(parsed).toMatchObject({method: 'POST', body: 'a=1', url: 'https://x'});
        });

        it('keeps an explicit method even when there is a body', () => {
            expect(parse("curl -X GET -d 'a=1' https://x").method).toBe('GET');
        });

        it('keeps multi-line quoted bodies intact', () => {
            const parsed = parse("curl https://x -d '{\n  \"a\": 1\n}'");

            expect(parsed.body).toBe('{\n  "a": 1\n}');
        });

        it('joins shell line continuations and skips stray backslashes', () => {
            const parsed = parse("curl \\\n  -X POST \\\r\n  -H 'A: b' \\\n  https://x \\\n  -d 'k=v'");
            const stray = parse('curl \\ https://y');

            expect(parsed).toEqual({method: 'POST', url: 'https://x', headers: [{key: 'A', value: 'b'}], body: 'k=v'});
            expect(stray.url).toBe('https://y');
        });

        it('ignores unknown flags and any second bare argument', () => {
            const parsed = parse('curl -s --compressed https://x extra');

            expect(parsed).toMatchObject({url: 'https://x', method: 'GET'});
        });

        it('tolerates flags that are missing their value', () => {
            expect(parse('curl https://x -X').method).toBe('GET');
            expect(parse('curl https://x -H').headers).toEqual([]);
            expect(parse('curl https://x -d')).toMatchObject({body: '', method: 'GET'});
            expect(parse('curl https://x --url')).toBeNull();
        });

        it('lets a method flag take the next argument, even if that was meant as the URL', () => {
            expect(parse('curl -X https://x/a')).toBeNull();
        });

        it('leaves a lone quote character alone', () => {
            expect(parse("curl '").url).toBe("'");
        });

        it.each([
            ['nothing that looks like curl', 'wget https://x'],
            ['no URL at all', 'curl -X POST'],
            ['only flags', 'curl -s -H "A: b"'],
            ['an empty string', '']
        ])('rejects %s', (_label, raw) => {
            expect(parse(raw)).toBeNull();
        });
    });

    describe('guessing the body type of an imported body', () => {
        it.each([
            ['', 'none'], ['   \n ', 'none'],
            ['{"a":1}', 'json'], ['  [1,2]', 'json'],
            ['<a/>', 'xml'], ['\n<?xml version="1.0"?><a/>', 'xml'],
            ['a=1', 'form'], ['a=1&b=2', 'form'], ['a=&b=x y', 'form'], ['user%40x=1&t=', 'form'],
            ['plain text', 'raw'], ['a=1&b', 'raw'], ['k=v=w', 'raw'], ['a b=1', 'raw'], ['=1', 'raw']
        ])('%j is %s', async (body, expected) => {
            await create();

            expect(component.guessBodyType(body)).toBe(expected);
        });
    });

    describe('import dialog', () => {
        const open = async (): Promise<{modal: any; form: any}> => {
            await create();
            menuAction(10, 'import-curl');
            const modal: any = lastModal();
            return {modal, form: modal.$el.find('.modal-body .aaxis-api__ref-form')};
        };
        const fill = (form: any, name: string, curl: string): void => {
            form.find('[data-role="curl-name"]').val(name);
            form.find('[data-role="curl-input"]').val(curl);
        };
        const status = (form: any): any => form.find('[data-role="curl-status"]');

        it('is a dialog with an Import button that stays open until the import is done', async () => {
            const {modal, form} = await open();

            expect(modal.options).toMatchObject({
                title: 'aaxis.tools.api_collection.menu_import_curl',
                okText: 'aaxis.tools.api_collection.import',
                okCloses: false
            });
            expect(modal.open).toHaveBeenCalled();
            expect(form.find('[data-role="curl-name"]').attr('placeholder')).toBe('aaxis.tools.api_collection.curl_name');
            expect(form.find('[data-role="curl-input"]').attr('placeholder')).toBe('curl https://...');
            expect(status(form).prop('hidden')).toBe(true);
        });

        it('asks for a name first and focuses the field', async () => {
            const {modal, form} = await open();
            fill(form, '  ', 'curl https://x');
            modal.$el.appendTo(document.body);
            const focused = vi.fn();
            form.find('[data-role="curl-name"]')[0].addEventListener('focus', focused);

            modal.emit('ok');

            expect(status(form).prop('hidden')).toBe(false);
            expect(status(form).attr('class')).toBe('aaxis-api__curl-status is-error');
            expect(status(form).text().trim()).toBe('aaxis.tools.api_collection.curl_name_required');
            expect(focused).toHaveBeenCalled();
            expect(api.callsTo('POST', '/nodes')).toHaveLength(0);
        });

        it('rejects text that is not a curl command', async () => {
            const {modal, form} = await open();
            fill(form, 'Req', 'wget https://x');

            modal.emit('ok');

            expect(status(form).text().trim()).toBe('aaxis.tools.api_collection.curl_invalid');
            expect(status(form).hasClass('is-error')).toBe(true);
            expect(api.callsTo('POST', '/nodes')).toHaveLength(0);
        });

        it('creates a request from the command inside the chosen folder, reloads and closes', async () => {
            const {modal, form} = await open();
            fill(form, ' Imported ', "curl -X put https://x/api -H 'A: b' -d '{\"k\":1}'");

            modal.emit('ok');
            await flush();

            expect(api.callsTo('POST', '/nodes')[0].body).toEqual({
                type: 'request', name: 'Imported', parentId: 10, method: 'PUT', url: 'https://x/api',
                headers: [{key: 'A', value: 'b'}], params: [], bodyType: 'json', body: '{"k":1}'
            });
            expect(component.expanded[10]).toBe(true);
            expect(api.callsTo('GET', '/tree')).toHaveLength(2);
            expect(modal.close).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['a form body', 'curl https://x -d "a=1&b=2"', 'form'],
            ['an XML body', "curl https://x -d '<a/>'", 'xml'],
            ['a raw body', "curl https://x -d 'hello world'", 'raw'],
            ['no body', 'curl https://x', 'none']
        ])('picks the body type for %s', async (_label, curl, bodyType) => {
            const {modal, form} = await open();
            fill(form, 'Req', curl);

            modal.emit('ok');
            await flush();

            expect(api.callsTo('POST', '/nodes')[0].body.bodyType).toBe(bodyType);
        });

        it('shows progress and blocks the dialog while importing, then unblocks on failure', async () => {
            let release: (value: unknown) => void = () => undefined;
            api.on('POST /nodes', () => new Promise(resolve => { release = resolve; }));
            const {modal, form} = await open();
            fill(form, 'Req', 'curl https://x');

            modal.emit('ok');
            await flush();

            expect(status(form).find('.fa-spinner')).toHaveLength(1);
            expect(status(form).text().trim()).toBe('aaxis.tools.api_collection.importing');
            expect(status(form).hasClass('is-error')).toBe(false);
            const blocked = modal.$el.find('.modal-footer .ok, .modal-footer .cancel, .close');
            expect(blocked.filter('.aaxis-api__btn-disabled')).toHaveLength(3);

            release(new Failed({success: false}));
            await flush();

            expect(modal.$el.find('.aaxis-api__btn-disabled')).toHaveLength(0);
            expect(status(form).hasClass('is-error')).toBe(true);
            expect(status(form).text().trim()).toBe('aaxis.tools.api_collection.error');
            expect(modal.close).not.toHaveBeenCalled();
        });

        it('ignores a second Import click while the first is running', async () => {
            let release: (value: unknown) => void = () => undefined;
            api.on('POST /nodes', () => new Promise(resolve => { release = resolve; }));
            const {modal, form} = await open();
            fill(form, 'Req', 'curl https://x');

            modal.emit('ok');
            await flush();
            modal.emit('ok');
            await flush();

            expect(api.callsTo('POST', '/nodes')).toHaveLength(1);
            release({success: true});
            await flush();
        });

        it('allows retrying after a failure', async () => {
            let attempts = 0;
            api.on('POST /nodes', () => (++attempts === 1 ? {success: false} : {success: true}));
            const {modal, form} = await open();
            fill(form, 'Req', 'curl https://x');

            modal.emit('ok');
            await flush();
            modal.emit('ok');
            await flush();

            expect(attempts).toBe(2);
            expect(modal.close).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['the server refuses it', () => new Failed({success: false, message: 'no'})],
            ['the server says it did not succeed', () => ({success: false})],
            ['the request fails outright', () => { throw new TypeError('offline'); }]
        ])('reports an error when %s', async (_label, handler) => {
            api.on('POST /nodes', handler);
            const {modal, form} = await open();
            fill(form, 'Req', 'curl https://x');

            modal.emit('ok');
            await flush();

            expect(status(form).text().trim()).toBe('aaxis.tools.api_collection.error');
            expect(modal.close).not.toHaveBeenCalled();
        });
    });
});
