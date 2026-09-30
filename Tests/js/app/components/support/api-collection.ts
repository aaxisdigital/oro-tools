import {vi} from 'vitest';
import CodeMirror from 'codemirror';
import Modal from 'oroui/js/modal';
import ApiCollectionComponent from '../../../../../Resources/js-src/app/components/api-collection-component';

/** The widget markup (Resources/views/Tools/apiCollection.html.twig), minus the page chrome. */
export const MARKUP = `
<div class="content">
    <button data-role="help"></button>
    <div class="aaxis-api" data-role="layout">
        <aside data-role="sidebar">
            <input type="text" data-role="filter">
            <button data-role="add-root-folder"></button>
            <ul data-role="tree"></ul>
            <div data-role="busy" hidden></div>
        </aside>
        <div class="is-disabled" data-role="main">
            <select data-role="method">
                <option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option><option value="DELETE">DELETE</option>
                <option value="OPTIONS">OPTIONS</option><option value="HEAD">HEAD</option>
            </select>
            <input type="text" data-role="url">
            <button data-role="send"><span class="fa fa-paper-plane"></span></button>
            <button data-role="tab" data-tab="params" class="is-active"></button>
            <button data-role="tab" data-tab="body"></button>
            <button data-role="tab" data-tab="headers"></button>
            <button data-role="max-request"><span class="fa fa-expand"></span></button>
            <div class="aaxis-api__panels">
                <div data-role="panel" data-tab="params">
                    <div data-role="params-rows"></div>
                    <button data-role="add-param"></button>
                </div>
                <div data-role="panel" data-tab="body" hidden>
                    <div class="aaxis-api__body-bar">
                        <select data-role="body-type">
                            <option value="none">none</option><option value="json">json</option><option value="xml">xml</option>
                            <option value="form">form</option><option value="raw">raw</option>
                        </select>
                        <button data-role="beautify" hidden></button>
                    </div>
                    <textarea data-role="body"></textarea>
                </div>
                <div data-role="panel" data-tab="headers" hidden>
                    <div data-role="headers-rows"></div>
                    <button data-role="add-header"></button>
                </div>
            </div>
            <button data-role="max-response"><span class="fa fa-expand"></span></button>
            <div data-role="result"><div class="aaxis-api__result-empty"></div></div>
        </div>
        <div class="is-collapsed" data-role="rightbar">
            <button data-role="rightbar-toggle"><span class="fa fa-chevron-left"></span></button>
            <ul data-role="runs"></ul>
        </div>
    </div>
    <div data-role="help-content" hidden><p>Api help</p></div>
</div>`;

export const URLS = {treeUrl: '/tree', createUrl: '/nodes', runUrl: '/runs', executeUrl: '/execute'};

export function request(id: number, name: string, extra: Record<string, unknown> = {}): any {
    return {
        id, type: 'request', name, parentId: null, public: false, owned: true,
        method: 'GET', url: '', params: [], headers: [], bodyType: 'none', body: '', ...extra
    };
}

export function folder(id: number, name: string, parentId: number | null = null, extra: Record<string, unknown> = {}): any {
    return {
        id, type: 'folder', name, parentId, public: false, owned: true,
        method: null, url: null, params: [], headers: [], bodyType: 'none', body: '', ...extra
    };
}

/** Marks a handler result as a non-2xx answer (fetch's `ok` is false, the body is still parsed). */
export class Failed {
    constructor(public body: unknown) {}
}

export interface Call {
    method: string;
    url: string;
    body: any;
    headers: Record<string, string> | undefined;
}

/**
 * fetch() stand-in for the API Collection endpoints. `GET /tree` answers from `nodes`/`runs`;
 * everything else answers `{success: true}` unless a handler is registered under "METHOD url".
 * A handler may return a body, `new Failed(body)`, or throw/reject to fail the request itself.
 */
export class FakeApi {
    nodes: any[] = [];
    runs: any[] = [];
    currentUserId: number | null = 7;
    calls: Call[] = [];
    handlers: Record<string, (body: any) => unknown> = {};

    fetch = vi.fn(async (url: string, init: any = {}) => {
        const method = init.method ?? 'GET';
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        this.calls.push({method, url, body, headers: init.headers});
        const key = method + ' ' + url;

        let result: unknown = {success: true};
        if (this.handlers[key]) {
            result = await this.handlers[key](body);
        } else if (key === 'GET ' + URLS.treeUrl) {
            result = {nodes: this.nodes, runs: this.runs, currentUserId: this.currentUserId};
        }

        const failed = result instanceof Failed;
        return {ok: !failed, json: () => Promise.resolve(failed ? (result as Failed).body : result)};
    });

    callsTo(method: string, url: string): Call[] {
        return this.calls.filter(c => c.method === method && c.url === url);
    }

    on(key: string, handler: (body: any) => unknown): this {
        this.handlers[key] = handler;
        return this;
    }
}

export async function flush(): Promise<void> {
    for (let i = 0; i < 60; i++) {
        await Promise.resolve();
    }
}

export async function createComponent($root: any, api: FakeApi, options: Record<string, unknown> = {}): Promise<any> {
    vi.stubGlobal('fetch', api.fetch);
    const component = new (ApiCollectionComponent as any)({_sourceElement: $root, ...URLS, ...options});
    await flush();
    return component;
}

/** The fake CodeMirror editor the component created for the body textarea. */
export function bodyEditorOf(component: any): any {
    return component.bodyEditor;
}

/** The most recently built dialog. */
export function lastModal(): Modal {
    return Modal.instances[Modal.instances.length - 1];
}

/** Re-exported so tests can drive/inspect the highlighter the response viewer uses. */
export {CodeMirror};
