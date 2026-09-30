import $ from 'jquery';
import {vi} from 'vitest';
import QueueMonitorComponent from '../../../../../Resources/js-src/app/components/queue-monitor-component';

/** The widget markup (Resources/views/Tools/queueMonitor.html.twig), minus the page chrome. */
export const MARKUP = `
<div class="content">
    <button data-role="help"></button>
    <div class="aaxis-queue-mon" data-role="layout">
        <aside data-role="sidebar">
            <input type="text" data-role="filter">
            <button data-role="filter-clear" hidden></button>
            <button data-role="refresh"></button>
            <input type="checkbox" data-role="autorefresh" checked>
            <button data-role="select-all"></button>
            <button data-role="select-none"></button>
            <ul data-role="queues"></ul>
        </aside>
        <div data-role="v-splitter"></div>
        <div data-role="detail"><div data-role="placeholder"></div></div>
    </div>
    <div data-role="help-content" hidden><p>Queue help</p></div>
</div>`;

export const URLS = {
    queuesUrl: '/queues',
    queuesDetailUrl: '/queues/detail',
    messagesUrlTemplate: '/queues/__NAME__/messages'
};

export interface FakeServer {
    queues: any[];
    details: any[];
    /** When set, the queue list request fails with this jqXHR-like object. */
    queuesError?: any;
    /** When true, the detail request fails. */
    detailError?: boolean;
    /** When set, the detail request returns exactly this list (unfiltered, possibly malformed). */
    rawDetails?: any[];
}

export function queue(name: string, ready = 0, unacked = 0, consumers = 0): any {
    return {name, state: 'running', messages: ready + unacked, messagesReady: ready, messagesUnacked: unacked, consumers, node: 'rabbit@host'};
}

export function detail(name: string, samples: any[] = [], extra: Record<string, unknown> = {}): any {
    return {...queue(name), durable: true, samplesAvailable: true, samples, ...extra};
}

/** Answers $.ajax synchronously from `server`; every request is recorded in the returned spy. */
export function mockServer(server: FakeServer): any {
    return vi.spyOn($, 'ajax').mockImplementation(((options: any) => {
        const deferred = $.Deferred();
        if (options.url === URLS.queuesUrl) {
            if (server.queuesError) {
                deferred.reject(server.queuesError);
            } else {
                deferred.resolve({queues: server.queues});
            }
        } else if (server.detailError) {
            deferred.reject({});
        } else {
            const names: string[] = options.data?.names ?? [];
            deferred.resolve({queues: server.rawDetails ?? server.details.filter(d => names.includes(d.name))});
        }
        return deferred.promise();
    }) as any);
}

export function createComponent($root: any, options: Record<string, unknown> = {}): any {
    return new (QueueMonitorComponent as any)({_sourceElement: $root, ...URLS, ...options});
}

export async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
}

/** A fetch() Response stand-in. */
export function response(body: unknown, ok = true): any {
    return {ok, json: () => Promise.resolve(body)};
}
