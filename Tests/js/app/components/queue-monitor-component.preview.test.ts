import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import messenger from 'oroui/js/messenger';
import {MARKUP, createComponent, detail, flush, mockServer, queue, response, type FakeServer} from './support/queue-monitor';

vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

const setUrl = (url: string): void => (globalThis as any).jsdom.reconfigure({url});

describe('QueueMonitorComponent: message preview, clipboard and splitter', () => {
    let $root: any;
    let component: any;
    let server: FakeServer;
    let fetchMock: any;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const create = (options: Record<string, unknown> = {}): any => {
        mockServer(server);
        component = createComponent($root, options);
        return component;
    };
    const preview = async (): Promise<void> => {
        role('preview').trigger('click');
        await flush();
    };
    const bodies = (): string[] => role('messages').find('.aaxis-queue-mon__message-body').map((_: number, el: any) => el.textContent).get();

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        server = {queues: [queue('alpha'), queue('my queue/1')], details: [detail('alpha'), detail('my queue/1')]};
        fetchMock = vi.fn().mockResolvedValue(response({messages: []}));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        document.cookie.split(';').forEach(c => {
            document.cookie = c.split('=')[0].trim() + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        });
        setUrl('http://localhost:3000/');
    });

    describe('previewing messages', () => {
        it('POSTs the count with the CSRF header to the URL of the chosen queue', async () => {
            document.cookie = '_csrf=tok%20en';
            create();
            role('queues').find('.aaxis-queue-mon__queue-main').last().trigger('click');
            role('detail').find('[data-role="preview-queue"]').val('my queue/1');
            role('detail').find('[data-role="preview-count"]').val('7');
            const event = $.Event('click');

            role('preview').trigger(event);
            await flush();

            expect(event.isDefaultPrevented()).toBe(true);
            expect(fetchMock).toHaveBeenCalledWith('/queues/my%20queue%2F1/messages', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'Content-Type': 'application/json', 'X-CSRF-Header': 'tok en'},
                body: '{"count":7}'
            });
        });

        it('reads the https-prefixed CSRF cookie on a secure page', async () => {
            setUrl('https://queues.example.test/');
            document.cookie = 'https-_csrf=secure-token';
            document.cookie = '_csrf=plain-token';
            create();

            await preview();

            expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Header']).toBe('secure-token');
        });

        it('sends an empty CSRF header when the cookie is missing', async () => {
            create();

            await preview();

            expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Header']).toBe('');
        });

        it.each([
            ['a non-numeric count falls back to 10', 'abc', 10],
            ['an empty count falls back to 10', '', 10],
            ['zero falls back to 10', '0', 10],
            ['a negative count falls back to 10', '-4', 10],
            ['a count above the limit is capped', '500', 100],
            ['a decimal count is truncated', '12.9', 12]
        ])('%s', async (_label, typed, expected) => {
            create();
            role('detail').find('[data-role="preview-count"]').val(typed);

            await preview();

            expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({count: expected});
            expect(role('detail').find('[data-role="preview-count"]').val()).toBe(String(expected));
        });

        it('falls back to the fetch limit when that is below 10', async () => {
            create({maxMessageFetch: 3});
            role('detail').find('[data-role="preview-count"]').val('nope');

            await preview();

            expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({count: 3});
        });

        it('shows a loading note and disables the button while the request is pending', async () => {
            let resolveFetch: (value: unknown) => void = () => undefined;
            fetchMock.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));
            create();

            role('preview').trigger('click');

            expect(role('messages').text()).toBe('aaxis.tools.queue_monitor.loading');
            expect(role('preview').prop('disabled')).toBe(true);

            resolveFetch(response({messages: []}));
            await flush();
            expect(role('preview').prop('disabled')).toBe(false);
        });

        it('does nothing when no queue is chosen', async () => {
            create();
            role('detail').find('[data-role="preview-queue"]').empty();

            await preview();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(role('preview').prop('disabled')).toBe(false);
        });

        it('reports an empty queue', async () => {
            create();

            await preview();

            expect(role('messages').text()).toBe('aaxis.tools.queue_monitor.no_messages');
        });

        it('tolerates a response without a messages list', async () => {
            fetchMock.mockResolvedValue(response({}));
            create();

            await preview();

            expect(role('messages').text()).toBe('aaxis.tools.queue_monitor.no_messages');
        });

        it('renders each message with its index, routing key, size and pretty-printed JSON body', async () => {
            fetchMock.mockResolvedValue(response({messages: [
                {payload: '{"a":1,"b":[2]}', payloadBytes: 15, routingKey: 'orders.created'},
                {payload: 'plain text', payloadBytes: 10, routingKey: ''}
            ]}));
            create();

            await preview();

            const $messages = role('messages').find('.aaxis-queue-mon__message');
            expect($messages).toHaveLength(2);
            expect($messages.eq(0).find('.aaxis-queue-mon__message-index').text()).toBe('#1');
            expect($messages.eq(0).find('.aaxis-queue-mon__message-meta').map((_: number, el: any) => el.textContent).get())
                .toEqual(['aaxis.tools.queue_monitor.routing_key: orders.created', '15 B']);
            expect($messages.eq(1).find('.aaxis-queue-mon__message-meta').map((_: number, el: any) => el.textContent).get())
                .toEqual(['10 B']);
            expect(bodies()).toEqual(['{\n  "a": 1,\n  "b": [\n    2\n  ]\n}', 'plain text']);
        });

        it('shows an error alert when the server answers with an error status', async () => {
            fetchMock.mockResolvedValue(response({message: 'forbidden'}, false));
            create();

            await preview();

            expect(role('messages').find('.alert.alert-error').text()).toBe('aaxis.tools.queue_monitor.preview_error');
            expect(role('preview').prop('disabled')).toBe(false);
        });

        it('shows an error alert for an error status without a body', async () => {
            fetchMock.mockResolvedValue({ok: false, json: () => Promise.resolve(null)});
            create();

            await preview();

            expect(role('messages').find('.alert.alert-error')).toHaveLength(1);
        });

        it('shows an error alert when the request itself fails', async () => {
            fetchMock.mockRejectedValue(new TypeError('network'));
            create();

            await preview();

            expect(role('messages').find('.alert.alert-error').text()).toBe('aaxis.tools.queue_monitor.preview_error');
            expect(role('preview').prop('disabled')).toBe(false);
        });
    });

    describe('copying a message', () => {
        const messageResponse = (): void => {
            fetchMock.mockResolvedValue(response({messages: [{payload: '{"k":"v"}', payloadBytes: 9, routingKey: 'rk'}]}));
        };
        const copy = (): any => {
            const event = $.Event('click');
            role('messages').find('.aaxis-queue-mon__message-copy').trigger(event);
            return event;
        };

        afterEach(() => {
            Reflect.deleteProperty(navigator, 'clipboard');
            Reflect.deleteProperty(document, 'execCommand');
        });

        it('writes the pretty-printed body to the clipboard and confirms', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
            messageResponse();
            create();
            await preview();

            const event = copy();
            await flush();

            expect(event.isDefaultPrevented()).toBe(true);
            expect(writeText).toHaveBeenCalledWith('{\n  "k": "v"\n}');
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('success', 'aaxis.tools.queue_monitor.copied');
        });

        it('reports a rejected clipboard write', async () => {
            Object.defineProperty(navigator, 'clipboard', {value: {writeText: vi.fn().mockRejectedValue(new Error('denied'))}, configurable: true});
            messageResponse();
            create();
            await preview();

            copy();
            await flush();

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('error', 'aaxis.tools.queue_monitor.copy_error');
        });

        it('falls back to a hidden textarea and execCommand without the clipboard API', async () => {
            const execCommand = vi.fn((command: string) => {
                const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
                expect(command).toBe('copy');
                expect(textarea.value).toBe('{\n  "k": "v"\n}');
                expect(textarea.style.position).toBe('fixed');
                return true;
            });
            (document as any).execCommand = execCommand;
            messageResponse();
            create();
            await preview();

            copy();

            expect(execCommand).toHaveBeenCalledTimes(1);
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('success', 'aaxis.tools.queue_monitor.copied');
            expect(document.querySelector('textarea')).toBeNull();
        });

        it('reports a refused fallback copy and still removes the textarea', async () => {
            (document as any).execCommand = vi.fn(() => { throw new Error('refused'); });
            messageResponse();
            create();
            await preview();

            copy();

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('error', 'aaxis.tools.queue_monitor.copy_error');
            expect(document.querySelector('textarea')).toBeNull();
        });
    });

    describe('sidebar splitter', () => {
        let sidebar: HTMLElement;

        const press = (clientX: number): void => {
            role('v-splitter').trigger($.Event('mousedown', {clientX}));
        };
        const move = (clientX: number): void => {
            $(document).trigger($.Event('mousemove', {clientX}));
        };

        beforeEach(() => {
            create();
            sidebar = role('sidebar')[0];
            vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({width: 300} as DOMRect);
        });

        it('resizes the sidebar with the drag distance and flags the page while dragging', () => {
            const event = $.Event('mousedown', {clientX: 100});
            role('v-splitter').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(document.body.classList.contains('aaxis-queue-mon-resizing')).toBe(true);

            move(150);
            expect(sidebar.style.flex).toBe('0 0 350px');
            move(60);
            expect(sidebar.style.flex).toBe('0 0 260px');
        });

        it('keeps the sidebar between 220 and 760 px', () => {
            press(0);

            move(-500);
            expect(sidebar.style.flex).toBe('0 0 220px');
            move(5000);
            expect(sidebar.style.flex).toBe('0 0 760px');
        });

        it('stops resizing on mouseup, clears the flag and redraws the chart', () => {
            const renderChart = vi.spyOn(component, 'renderChart');
            press(100);

            $(document).trigger('mouseup');
            move(200);

            expect(document.body.classList.contains('aaxis-queue-mon-resizing')).toBe(false);
            expect(sidebar.style.flex).toBe('');
            expect(renderChart).toHaveBeenCalledTimes(1);
        });

        it('copes with a page that has no sidebar', () => {
            component.dispose();
            $root.find('[data-role="sidebar"]').remove();
            create();

            press(10);
            move(50);
            $(document).trigger('mouseup');

            expect(document.body.classList.contains('aaxis-queue-mon-resizing')).toBe(false);
        });

        it('removes the body flag on dispose even mid-drag', () => {
            press(100);

            component.dispose();

            expect(document.body.classList.contains('aaxis-queue-mon-resizing')).toBe(false);
            move(200);
            expect(sidebar.style.flex).toBe('');
        });
    });
});
