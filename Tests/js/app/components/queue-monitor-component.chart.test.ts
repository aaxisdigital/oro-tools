import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MARKUP, createComponent, detail, mockServer, queue, type FakeServer} from './support/queue-monitor';

vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

const sample = (timestamp: any, total: number | null, ready: number | null = null, unacked: number | null = null): any =>
    ({timestamp, total, ready, unacked});

describe('QueueMonitorComponent: history chart and samples table', () => {
    let $root: any;
    let component: any;
    let server: FakeServer;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const create = (options: Record<string, unknown> = {}): any => {
        mockServer(server);
        component = createComponent($root, options);
        return component;
    };
    const toggle = (name: string): void => {
        role('queues').find(`.aaxis-queue-mon__queue-main[data-name="${name}"]`).trigger('click');
    };
    const attrs = (selector: string, attr: string): string[] =>
        role('chart').find(selector).map((_: number, el: any) => el.getAttribute(attr)).get();

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        server = {queues: [queue('alpha'), queue('beta')], details: []};
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
    });

    describe('chart geometry', () => {
        it('draws one polyline per queue in the compact size (260x160 minimum), scaled to the largest value', () => {
            server.details = [detail('alpha', [sample(1000, 0), sample(2000, 10)])];

            create();

            const $svg = role('chart').find('svg');
            expect($svg.attr('width')).toBe('260');
            expect($svg.attr('height')).toBe('160');
            expect($svg.attr('viewBox')).toBe('0 0 260 160');
            expect(attrs('polyline', 'points')).toEqual(['10.0,142.0 248.0,10.0']);
            expect(attrs('polyline', 'stroke')).toEqual(['#2b84ed']);
            expect(role('chart').find('line')).toHaveLength(5);
            expect(role('chart').find('text')).toHaveLength(0);
        });

        it('adds Y-axis captions and a wider left margin when maximized', () => {
            server.details = [detail('alpha', [sample(1000, 0), sample(2000, 10)])];
            create();

            role('maximize').trigger('click');
            vi.advanceTimersByTime(20);

            expect(role('chart').find('svg').attr('height')).toBe('240');
            expect(role('chart').find('text').map((_: number, el: any) => el.textContent).get())
                .toEqual(['10', '8', '5', '3', '0']);
            expect(attrs('line', 'x1')[0]).toBe('48');
            expect(attrs('polyline', 'points')[0]).toMatch(/^48\.0,/);
        });

        it('uses the measured container size when it is larger than the minimum', () => {
            server.details = [detail('alpha', [sample(1000, 1), sample(2000, 2)])];
            create();
            vi.spyOn(role('chart')[0], 'getBoundingClientRect').mockReturnValue({width: 600.4, height: 300.2} as DOMRect);

            component.renderChart();

            expect(role('chart').find('svg').attr('width')).toBe('600');
            expect(role('chart').find('svg').attr('height')).toBe('300');
        });

        it('places a lone timestamp on the left margin instead of dividing by zero', () => {
            server.details = [detail('alpha', [sample(5000, 3)])];

            create();

            expect(attrs('polyline', 'points')).toEqual(['10.0,' + (160 - 18 - (3 / 3) * (160 - 28)).toFixed(1)]);
        });

        it('plots several queues with their own colours, in list order, on a common scale', () => {
            server.details = [
                detail('alpha', [sample(1000, 4), sample(2000, 8)]),
                detail('beta', [sample(1000, 8), sample(2000, 4)])
            ];
            create();

            toggle('beta');

            expect(attrs('polyline', 'stroke')).toEqual(['#2b84ed', '#e6492d']);
            expect(attrs('polyline', 'points')).toEqual([
                '10.0,76.0 248.0,10.0',
                '10.0,10.0 248.0,76.0'
            ]);
        });

        it('shows the time range and the peak in the caption', () => {
            server.details = [detail('alpha', [sample(1000, 2), sample(9000, 7)])];

            create();

            const caption = role('chart').find('.aaxis-queue-mon__chart-caption').text();
            expect(caption).toBe('aaxis.tools.queue_monitor.chart_caption ' + JSON.stringify({
                start: new Date(1000).toLocaleTimeString(),
                end: new Date(9000).toLocaleTimeString(),
                max: 7
            }));
        });

        it('never scales below 1, so an all-zero history still draws a flat line', () => {
            server.details = [detail('alpha', [sample(1000, 0), sample(2000, 0)])];

            create();

            expect(attrs('polyline', 'points')).toEqual(['10.0,142.0 248.0,142.0']);
            expect(role('chart').find('.aaxis-queue-mon__chart-caption').text()).toContain('"max":1');
        });

        it('does nothing when the chart container is not on the page', () => {
            create();
            role('detail').empty();

            expect(() => component.renderChart()).not.toThrow();
        });

        it('redraws on window resize, coalescing bursts into one frame', () => {
            create();
            const renderChart = vi.spyOn(component, 'renderChart');

            $(window).trigger('resize');
            $(window).trigger('resize');
            $(window).trigger('resize');
            expect(renderChart).not.toHaveBeenCalled();
            vi.advanceTimersByTime(20);

            expect(renderChart).toHaveBeenCalledTimes(1);
        });
    });

    describe('series values', () => {
        it('prefers the total and otherwise sums ready and unacked, treating missing counters as zero', () => {
            server.details = [detail('alpha', [
                sample(1000, 9, 1, 1),
                sample(2000, null, 3, 4),
                sample(3000, null, 5, null),
                sample(4000, null, null, 6),
                sample(5000, null)
            ])];

            create();

            const rows = role('samples').find('tbody tr').map((_: number, tr: any) =>
                $(tr).find('td').last().text()).get();
            expect(rows).toEqual(['0', '6', '5', '7', '9']);
        });

        it('sorts points by time and drops samples without a finite timestamp', () => {
            server.details = [detail('alpha', [sample(3000, 3), sample(NaN, 100), sample(null, 200), sample(1000, 1), sample(2000, 2)])];

            create();

            expect(attrs('polyline', 'points')[0].split(' ')).toHaveLength(3);
            expect(role('chart').find('.aaxis-queue-mon__chart-caption').text()).toContain('"max":3');
        });

        it('skips a selected queue whose detail has not arrived and draws the others', () => {
            server.details = [detail('alpha', [sample(1000, 1), sample(2000, 2)])];
            create();

            toggle('beta');

            expect(role('chart').find('polyline')).toHaveLength(1);
        });

        it('tolerates a detail without a samples array', () => {
            server.details = [{...detail('alpha'), samples: undefined}];

            create();

            expect(role('chart').text()).toBe('aaxis.tools.queue_monitor.no_history');
        });

        it('says there is no history for a selection whose queues are missing from the response', () => {
            server.details = [];

            create();

            expect(role('chart').text()).toBe('aaxis.tools.queue_monitor.no_history');
        });
    });

    describe('recent samples table', () => {
        it('lists the newest samples first, one column per selected queue with a colour swatch', () => {
            server.details = [
                detail('alpha', [sample(1000, 1), sample(2000, 2)]),
                detail('beta', [sample(2000, 20), sample(3000, 30)])
            ];
            create();

            toggle('beta');

            const heads = role('samples').find('thead th').map((_: number, th: any) => th.textContent).get();
            expect(heads).toEqual(['aaxis.tools.queue_monitor.sample_time', 'alpha', 'beta']);
            const body = role('samples').find('tbody tr').toArray().map((tr: any) =>
                $(tr).find('td').toArray().slice(1).map((td: any) => td.textContent));
            expect(body).toEqual([['-', '30'], ['2', '20'], ['1', '-']]);
            const firstTime = role('samples').find('tbody tr').first().find('td').first().text();
            expect(firstTime).toBe(new Date(3000).toLocaleString());
            expect(role('samples').find('thead .aaxis-queue-mon__legend-swatch').map((_: number, el: any) => el.getAttribute('style')).get())
                .toEqual(['background:#2b84ed', 'background:#e6492d']);
        });

        it('shows the empty-history message when no queue has samples', () => {
            server.details = [detail('alpha', [])];

            create();

            expect(role('samples').find('table')).toHaveLength(0);
            expect(role('samples').text()).toBe('aaxis.tools.queue_monitor.no_history');
        });

        it('is skipped quietly when the samples container is gone', () => {
            create();
            role('samples').remove();

            expect(() => component.renderSamplesTable()).not.toThrow();
        });

        it('does not redraw anything while the selection is empty', () => {
            create();
            role('select-none').trigger('click');
            const renderChart = vi.spyOn(component, 'renderChart');

            component.updateDynamic();

            expect(renderChart).not.toHaveBeenCalled();
        });
    });
});
