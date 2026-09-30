import {vi} from 'vitest';

/**
 * Stand-in for CodeMirror 5. jsdom has no layout, so the real editor is not worth running: this
 * fake editor keeps its value and exposes spies for the calls the widgets make.
 */
export function createFakeEditor(initial = ''): any {
    let value = initial;
    const handlers: Record<string, Array<(...args: any[]) => void>> = {};
    const marks: any[] = [];
    const indexOf = (pos: {line: number; ch: number}): number =>
        value.split('\n').slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
    const editor: any = {
        getValue: vi.fn(() => value),
        setValue: vi.fn((next: string) => {
            value = next;
            (handlers.change || []).forEach(handler => handler(editor));
        }),
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
            (handlers[event] ||= []).push(handler);
        }),
        off: vi.fn(),
        refresh: vi.fn(),
        focus: vi.fn(),
        setOption: vi.fn(),
        getOption: vi.fn(),
        setSize: vi.fn(),
        toTextArea: vi.fn(),
        save: vi.fn(),
        getWrapperElement: vi.fn(() => document.createElement('div')),
        // Text positions, ranges and marks (used by widgets that decorate or splice the document).
        /** Test helper: where getCursor() reports the caret; defaults to the end of the text. */
        cursor: null as {line: number; ch: number} | null,
        getCursor: vi.fn(() => editor.cursor ?? editor.posFromIndex(value.length)),
        posFromIndex: vi.fn((index: number) => {
            const before = value.slice(0, index).split('\n');
            return {line: before.length - 1, ch: before[before.length - 1].length};
        }),
        getRange: vi.fn((from: {line: number; ch: number}, to: {line: number; ch: number}) =>
            value.slice(indexOf(from), indexOf(to))),
        replaceRange: vi.fn((text: string, from: {line: number; ch: number}, to: {line: number; ch: number} = from) => {
            value = value.slice(0, indexOf(from)) + text + value.slice(indexOf(to));
            (handlers.change || []).forEach(handler => handler(editor));
        }),
        getAllMarks: vi.fn(() => [...marks]),
        markText: vi.fn((from: unknown, to: unknown, options: unknown) => {
            const mark: any = {
                from, to, options,
                clear: vi.fn(() => { marks.splice(marks.indexOf(mark), 1); }),
                find: vi.fn(() => ({from, to}))
            };
            marks.push(mark);
            return mark;
        }),
        /** Test helper: fire an editor event, e.g. `editor.emit('change')`. */
        emit: (event: string, ...args: any[]) => (handlers[event] || []).forEach(handler => handler(editor, ...args))
    };
    return editor;
}

const CodeMirror: any = {
    fromTextArea: vi.fn((textarea: HTMLTextAreaElement) => createFakeEditor(textarea?.value ?? '')),
    runMode: vi.fn(),
    defineMode: vi.fn(),
    defineMIME: vi.fn()
};

export default CodeMirror;
