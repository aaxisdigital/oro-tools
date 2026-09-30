import $ from 'jquery';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import Base64Component from '../../../../Resources/js-src/app/components/base64-component';

// The plain stub returns the bare key; here the params are appended so the counters can be asserted.
vi.mock('orotranslation/js/translator', () => ({
    default: (key: string, params?: Record<string, unknown>) => (params ? key + ' ' + JSON.stringify(params) : key)
}));

/** The widget markup (Resources/views/Tools/base64.html.twig), minus the page chrome. */
const MARKUP = `
<div class="aaxis-base64">
    <button data-role="help"></button>
    <button data-role="mode" data-mode="encode" class="is-active"></button>
    <button data-role="mode" data-mode="decode"></button>
    <span data-role="input-title"></span><span data-role="input-count"></span>
    <textarea data-role="input"></textarea>
    <div data-role="dropzone" hidden>
        <button data-role="browse"></button>
        <p data-role="file-name" hidden></p>
        <input type="file" data-role="file" hidden>
    </div>
    <button data-role="input-clear"></button>
    <div data-role="source-toggle">
        <button data-role="source" data-source="text" class="is-active"></button>
        <button data-role="source" data-source="file"></button>
    </div>
    <button data-role="swap"></button>
    <span data-role="output-title"></span><span data-role="output-count"></span>
    <textarea data-role="output" readonly></textarea>
    <div data-role="binary" hidden><p data-role="binary-text"></p></div>
    <p data-role="error" hidden></p>
    <button data-role="copy"></button>
    <button data-role="download" hidden></button>
    <p data-role="hint"></p>
    <div data-role="help-content" hidden><p>Help body</p></div>
</div>`;

const b64 = (text: string): string => Buffer.from(text, 'utf-8').toString('base64');
const byte = (...values: number[]): string => Buffer.from(values).toString('base64');
const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
        await Promise.resolve();
    }
};

describe('Base64Component', () => {
    let $root: any;
    let component: any;

    const role = (name: string): any => $root.find(`[data-role="${name}"]`);
    const create = (): any => {
        component = new (Base64Component as any)({_sourceElement: $root});
        return component;
    };
    const typeInput = (value: string): void => {
        role('input').val(value).trigger('input');
        vi.advanceTimersByTime(120);
    };
    const switchMode = (mode: string): void => {
        $root.find(`[data-role="mode"][data-mode="${mode}"]`).trigger('click');
    };

    beforeEach(() => {
        vi.useFakeTimers();
        $root = $(MARKUP).appendTo(document.body);
        Modal.instances.length = 0;
    });

    afterEach(() => {
        component?.dispose();
        component = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('initial state', () => {
        it('starts in encode/text mode with the encode captions and no download button', () => {
            create();

            expect(role('input-title').text()).toBe('aaxis.tools.base64.input_text');
            expect(role('output-title').text()).toBe('aaxis.tools.base64.output_base64');
            expect(role('hint').text()).toBe('aaxis.tools.base64.hint_encode');
            expect(role('input').attr('placeholder')).toBe('aaxis.tools.base64.ph_encode_text');
            expect(role('output').attr('placeholder')).toBe('aaxis.tools.base64.ph_output');
            expect(role('source-toggle').css('display')).not.toBe('none');
            expect(role('input').prop('hidden')).toBe(false);
            expect(role('dropzone').prop('hidden')).toBe(true);
            expect(role('download').prop('hidden')).toBe(true);
            expect(role('binary').prop('hidden')).toBe(true);
            expect(role('error').prop('hidden')).toBe(true);
        });

        it('leaves the counters empty for an empty input', () => {
            create();

            expect(role('input-count').text()).toBe('aaxis.tools.base64.count_chars {"count":0}');
            expect(role('output-count').text()).toBe('');
        });
    });

    describe('mode and source switching', () => {
        it('switches to decode: swaps the captions, hides the text/file toggle and marks the tab active', () => {
            create();

            switchMode('decode');

            expect(role('input-title').text()).toBe('aaxis.tools.base64.input_base64');
            expect(role('output-title').text()).toBe('aaxis.tools.base64.output_text');
            expect(role('hint').text()).toBe('aaxis.tools.base64.hint_decode');
            expect(role('input').attr('placeholder')).toBe('aaxis.tools.base64.ph_decode');
            expect(role('source-toggle').css('display')).toBe('none');
            expect($root.find('[data-mode="decode"]').hasClass('is-active')).toBe(true);
            expect($root.find('[data-mode="encode"]').hasClass('is-active')).toBe(false);
        });

        it('clears the input when the mode changes, but ignores a click on the current mode', () => {
            create();
            typeInput('hello');
            expect(role('output').val()).toBe(b64('hello'));

            switchMode('encode');
            expect(role('input').val()).toBe('hello');

            switchMode('decode');
            expect(role('input').val()).toBe('');
            expect(role('output').val()).toBe('');
        });

        it('shows the dropzone instead of the textarea for the file source, and back', () => {
            create();

            $root.find('[data-source="file"]').trigger('click');
            expect(role('input').prop('hidden')).toBe(true);
            expect(role('dropzone').prop('hidden')).toBe(false);
            expect($root.find('[data-source="file"]').hasClass('is-active')).toBe(true);
            expect($root.find('[data-source="text"]').hasClass('is-active')).toBe(false);

            $root.find('[data-source="text"]').trigger('click');
            expect(role('input').prop('hidden')).toBe(false);
            expect(role('dropzone').prop('hidden')).toBe(true);
        });

        it('ignores a click on the current source (the typed text survives)', () => {
            create();
            typeInput('keep me');

            $root.find('[data-source="text"]').trigger('click');

            expect(role('input').val()).toBe('keep me');
        });

        it('shows an empty output for the file source until a file is chosen', () => {
            create();
            typeInput('abc');

            $root.find('[data-source="file"]').trigger('click');

            expect(role('output').val()).toBe('');
            expect(role('input-count').text()).toBe('aaxis.tools.base64.count_bytes {"count":0}');
            expect(role('output-count').text()).toBe('');
        });
    });

    describe('encoding text', () => {
        it('encodes UTF-8 text live, after a 120 ms debounce', () => {
            create();
            role('input').val('héllo €').trigger('input');

            vi.advanceTimersByTime(119);
            expect(role('output').val()).toBe('');

            vi.advanceTimersByTime(1);
            expect(role('output').val()).toBe(b64('héllo €'));
            expect(role('input-count').text()).toBe('aaxis.tools.base64.count_chars {"count":7}');
            expect(role('output-count').text())
                .toBe(`aaxis.tools.base64.count_chars {"count":${b64('héllo €').length}}`);
        });

        it('restarts the debounce on every keystroke', () => {
            create();
            role('input').val('a').trigger('input');
            vi.advanceTimersByTime(100);
            role('input').val('ab').trigger('input');
            vi.advanceTimersByTime(100);
            expect(role('output').val()).toBe('');

            vi.advanceTimersByTime(20);

            expect(role('output').val()).toBe(b64('ab'));
        });

        it('encodes input larger than one 32 KiB chunk without corrupting it', () => {
            create();
            const big = 'x'.repeat(0x8000 + 10);

            typeInput(big);

            expect(role('output').val()).toBe(b64(big));
        });

        it('clears the fields with the Clear button', () => {
            create();
            typeInput('hello');
            const event = $.Event('click');

            role('input-clear').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(role('input').val()).toBe('');
            expect(role('output').val()).toBe('');
            expect(role('output-count').text()).toBe('');
        });
    });

    describe('decoding', () => {
        beforeEach(() => {
            create();
            switchMode('decode');
        });

        it('decodes valid Base64 to text and reports the counts', () => {
            typeInput(b64('héllo €'));

            expect(role('output').val()).toBe('héllo €');
            expect(role('error').prop('hidden')).toBe(true);
            expect(role('input-count').text())
                .toBe(`aaxis.tools.base64.count_chars {"count":${b64('héllo €').length}}`);
            expect(role('output-count').text()).toBe('aaxis.tools.base64.count_chars {"count":7}');
        });

        it('tolerates whitespace, JSON-escaped slashes, the URL-safe alphabet and missing padding', () => {
            const plain = '???>>>~~~ subjects?';
            const standard = b64(plain);
            expect(standard).toMatch(/[+/]/);
            const urlSafe = standard.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

            typeInput(urlSafe);
            expect(role('output').val()).toBe(plain);

            typeInput('  ' + standard.slice(0, 8) + '\n' + standard.slice(8) + ' \n');
            expect(role('output').val()).toBe(plain);

            typeInput(standard.replaceAll('/', '\\/'));
            expect(role('output').val()).toBe(plain);
        });

        it('trims an arbitrarily long run of "=" padding without hanging', () => {
            typeInput(b64('ab') + '='.repeat(50000));

            expect(role('output').val()).toBe('ab');
        });

        it('shows an error for a Base64 string of impossible length', () => {
            typeInput('QUJDR');

            expect(role('error').prop('hidden')).toBe(false);
            expect(role('error').text()).toBe('aaxis.tools.base64.invalid');
            expect(role('output').val()).toBe('');
            expect(role('input-count').text()).toBe('aaxis.tools.base64.count_chars {"count":5}');
            expect(role('output-count').text()).toBe('');
        });

        it('shows an error for characters outside the Base64 alphabet, then recovers', () => {
            typeInput('not base64!!');
            expect(role('error').text()).toBe('aaxis.tools.base64.invalid');
            expect(role('output').val()).toBe('');

            typeInput(b64('ok'));
            expect(role('error').prop('hidden')).toBe(true);
            expect(role('error').text()).toBe('');
            expect(role('output').val()).toBe('ok');
        });

        it('shows empty counters for an empty input', () => {
            typeInput('   ');

            expect(role('output').val()).toBe('');
            expect(role('input-count').text()).toBe('aaxis.tools.base64.count_chars {"count":0}');
            expect(role('output-count').text()).toBe('');
        });

        it('offers a download instead of text when the payload is not valid UTF-8', () => {
            typeInput(byte(0x25, 0x50, 0x44, 0x46, 0xFF, 0xFE));

            expect(role('output').prop('hidden')).toBe(true);
            expect(role('output').val()).toBe('');
            expect(role('binary').prop('hidden')).toBe(false);
            expect(role('binary-text').text())
                .toBe('aaxis.tools.base64.binary_notice {"size":6,"type":"PDF document"}');
            expect(role('download').prop('hidden')).toBe(false);
            expect(role('output-count').text()).toBe('aaxis.tools.base64.count_bytes {"count":6}');
        });

        it('hides the binary panel and the download button again once text is decoded', () => {
            typeInput(byte(0xFF, 0xFE, 0xFD));
            expect(role('download').prop('hidden')).toBe(false);

            typeInput(b64('text'));

            expect(role('download').prop('hidden')).toBe(true);
            expect(role('binary').prop('hidden')).toBe(true);
            expect(role('output').prop('hidden')).toBe(false);
        });
    });

    describe('binary type sniffing', () => {
        const ascii = (text: string): number[] => [...text].map(c => c.charCodeAt(0));
        const cases: Array<[string, number[], string, string, string]> = [
            ['PDF', [...ascii('%PDF'), 0xFF], 'pdf', 'application/pdf', 'PDF document'],
            ['PNG', [0x89, 0x50, 0x4E, 0x47, 0x0D], 'png', 'image/png', 'PNG image'],
            ['JPEG', [0xFF, 0xD8, 0xFF, 0xE0], 'jpg', 'image/jpeg', 'JPEG image'],
            ['GIF', [...ascii('GIF89a'), 0xFF], 'gif', 'image/gif', 'GIF image'],
            ['WebP', [...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'), 0xFF], 'webp', 'image/webp', 'WebP image'],
            ['WAV', [...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE'), 0xFF], 'wav', 'audio/wav', 'WAV audio'],
            ['BMP', [0x42, 0x4D, 0xFF], 'bmp', 'image/bmp', 'BMP image'],
            ['GZIP', [0x1F, 0x8B, 0x08], 'gz', 'application/gzip', 'GZIP archive'],
            ['ZIP (local header)', [0x50, 0x4B, 0x03, 0x04, 0xFF], 'zip', 'application/zip', 'ZIP archive'],
            ['ZIP (empty archive)', [0x50, 0x4B, 0x05, 0x06, 0xFF], 'zip', 'application/zip', 'ZIP archive'],
            ['MP3 with ID3 tag', [...ascii('ID3'), 0xFF], 'mp3', 'audio/mpeg', 'MP3 audio'],
            ['MP3 frame sync', [0xFF, 0xFB, 0x90], 'mp3', 'audio/mpeg', 'MP3 audio'],
            ['OGG', [...ascii('OggS'), 0xFF], 'ogg', 'audio/ogg', 'OGG media'],
            ['TIFF little endian', [0x49, 0x49, 0x2A, 0x00, 0xFF], 'tif', 'image/tiff', 'TIFF image'],
            ['TIFF big endian', [0x4D, 0x4D, 0x00, 0x2A, 0xFF], 'tif', 'image/tiff', 'TIFF image'],
            ['RIFF that is neither WebP nor WAV', [...ascii('RIFF'), 1, 2, 3, 4, ...ascii('AVI '), 0xFF], 'bin', 'application/octet-stream', 'binary'],
            ['truncated signature', [0x89, 0x50, 0xFF], 'bin', 'application/octet-stream', 'binary'],
            ['unknown bytes', [0x00, 0x01, 0x02, 0xFF], 'bin', 'application/octet-stream', 'binary']
        ];

        it.each(cases)('recognises %s', (_label, bytes, ext, mime, label) => {
            const instance = create();

            expect(instance.sniffType(Uint8Array.from(bytes))).toEqual({ext, mime, label});
        });
    });

    describe('file input', () => {
        const fileOf = (name: string, bytes: number[]): any => ({
            name,
            arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer)
        });

        beforeEach(() => {
            create();
            $root.find('[data-source="file"]').trigger('click');
        });

        const chooseFile = (file: any): void => {
            const input = role('file')[0];
            Object.defineProperty(input, 'files', {value: file ? [file] : [], configurable: true});
            $(input).trigger('change');
        };

        it('encodes the chosen file to pure Base64 and shows its name and byte size', async () => {
            chooseFile(fileOf('data.bin', [1, 2, 3, 4, 5]));
            await flush();

            expect(role('output').val()).toBe(byte(1, 2, 3, 4, 5));
            expect(role('file-name').prop('hidden')).toBe(false);
            expect(role('file-name').text()).toBe('data.bin');
            expect(role('input-count').text()).toBe('aaxis.tools.base64.count_bytes {"count":5}');
            expect(role('output-count').text()).toBe('aaxis.tools.base64.count_chars {"count":8}');
        });

        it('does nothing when the change event carries no file', async () => {
            chooseFile(null);
            await flush();

            expect(role('output').val()).toBe('');
            expect(role('file-name').prop('hidden')).toBe(true);
        });

        it('reports a read failure without touching the output', async () => {
            chooseFile({name: 'broken', arrayBuffer: () => Promise.reject(new Error('unreadable'))});
            await flush();

            expect(messenger.notificationFlashMessage)
                .toHaveBeenCalledWith('error', 'aaxis.tools.base64.read_error');
            expect(role('output').val()).toBe('');
        });

        it('forgets the file when the source is switched back and forth', async () => {
            chooseFile(fileOf('data.bin', [9]));
            await flush();
            expect(role('output').val()).toBe(byte(9));

            $root.find('[data-source="text"]').trigger('click');
            $root.find('[data-source="file"]').trigger('click');

            expect(role('output').val()).toBe('');
            expect(role('file-name').prop('hidden')).toBe(true);
            expect(role('file-name').text()).toBe('');
        });

        it('opens the native file dialog from the Browse link', () => {
            const clicked = vi.fn();
            role('file')[0].addEventListener('click', clicked);
            const event = $.Event('click');

            role('browse').trigger(event);

            expect(clicked).toHaveBeenCalledTimes(1);
            expect(event.isDefaultPrevented()).toBe(true);
        });
    });

    describe('dropzone', () => {
        const dropEvent = (files?: any[]): any => {
            const event: any = $.Event('drop');
            event.originalEvent = {preventDefault: () => undefined, dataTransfer: files === undefined ? undefined : {files}};
            return event;
        };

        beforeEach(() => {
            create();
            $root.find('[data-source="file"]').trigger('click');
        });

        it('highlights while a drag hovers over it and un-highlights on leave/end', () => {
            const event = $.Event('dragover');
            role('dropzone').trigger(event);
            expect(role('dropzone').hasClass('is-dragover')).toBe(true);
            expect(event.isDefaultPrevented()).toBe(true);

            role('dropzone').trigger('dragleave');
            expect(role('dropzone').hasClass('is-dragover')).toBe(false);

            role('dropzone').trigger('dragover');
            role('dropzone').trigger('dragend');
            expect(role('dropzone').hasClass('is-dragover')).toBe(false);
        });

        it('encodes the first dropped file', async () => {
            role('dropzone').addClass('is-dragover');

            role('dropzone').trigger(dropEvent([
                {name: 'a.txt', arrayBuffer: () => Promise.resolve(new TextEncoder().encode('dropped').buffer)}
            ]));
            await flush();

            expect(role('dropzone').hasClass('is-dragover')).toBe(false);
            expect(role('output').val()).toBe(b64('dropped'));
            expect(role('file-name').text()).toBe('a.txt');
        });

        it('ignores a drop without files or without a data transfer', async () => {
            role('dropzone').trigger(dropEvent([]));
            role('dropzone').trigger(dropEvent(undefined));
            await flush();

            expect(role('output').val()).toBe('');
        });
    });

    describe('copy', () => {
        const clipboard = (writeText: unknown): void => {
            Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
        };

        afterEach(() => {
            Reflect.deleteProperty(navigator, 'clipboard');
        });

        beforeEach(() => {
            create();
        });

        it('copies the output and confirms', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            clipboard(writeText);
            typeInput('hello');

            role('copy').trigger('click');
            await flush();

            expect(writeText).toHaveBeenCalledWith(b64('hello'));
            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('success', 'aaxis.tools.base64.copied');
        });

        it('reports a rejected clipboard write', async () => {
            clipboard(vi.fn().mockRejectedValue(new Error('denied')));
            typeInput('hello');

            role('copy').trigger('click');
            await flush();

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('error', 'aaxis.tools.base64.copy_error');
        });

        it('reports an unavailable clipboard API', () => {
            typeInput('hello');

            role('copy').trigger('click');

            expect(messenger.notificationFlashMessage).toHaveBeenCalledWith('error', 'aaxis.tools.base64.copy_error');
        });

        it('does nothing when there is no output to copy', () => {
            const writeText = vi.fn();
            clipboard(writeText);

            role('copy').trigger('click');

            expect(writeText).not.toHaveBeenCalled();
            expect(messenger.notificationFlashMessage).not.toHaveBeenCalled();
        });
    });

    describe('download', () => {
        let createObjectURL: any;
        let revokeObjectURL: any;
        let anchorClick: any;
        let downloaded: Array<{name: string; href: string}>;

        beforeEach(() => {
            createObjectURL = vi.fn(() => 'blob:decoded');
            revokeObjectURL = vi.fn();
            vi.stubGlobal('URL', Object.assign(function () { /* unused */ }, {createObjectURL, revokeObjectURL}));
            downloaded = [];
            anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
                downloaded.push({name: this.download, href: this.href});
                expect(document.body.contains(this)).toBe(true);
            });
            create();
            switchMode('decode');
        });

        it('saves the decoded bytes under a name derived from the sniffed type', () => {
            typeInput(byte(0x25, 0x50, 0x44, 0x46, 0xFF));

            role('download').trigger('click');

            expect(anchorClick).toHaveBeenCalledTimes(1);
            expect(downloaded).toEqual([{name: 'decoded.pdf', href: 'blob:decoded'}]);
            const blob: Blob = createObjectURL.mock.calls[0][0];
            expect(blob.type).toBe('application/pdf');
            expect(blob.size).toBe(5);
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:decoded');
            expect(document.querySelector('a[download]')).toBeNull();
        });

        it('falls back to a generic .bin file for unknown content', () => {
            typeInput(byte(0x00, 0x01, 0xFF));

            role('download').trigger('click');

            expect(downloaded[0].name).toBe('decoded.bin');
            expect(createObjectURL.mock.calls[0][0].type).toBe('application/octet-stream');
        });

        it('defaults the type and extension when the payload was not sniffed', () => {
            component.binaryBytes = Uint8Array.from([1, 2]);
            component.binaryMime = null;
            component.binaryExt = null;

            component.onDownload($.Event('click'));

            expect(createObjectURL.mock.calls[0][0].type).toBe('application/octet-stream');
            expect(downloaded[0].name).toBe('decoded.bin');
        });

        it('does nothing when there is no binary payload', () => {
            typeInput(b64('text'));

            component.onDownload($.Event('click'));

            expect(createObjectURL).not.toHaveBeenCalled();
            expect(anchorClick).not.toHaveBeenCalled();
        });
    });

    describe('swap', () => {
        beforeEach(() => {
            create();
        });

        it('moves the encoded output into the input and flips to decode, which restores the text', () => {
            typeInput('round trip');

            role('swap').trigger('click');

            expect(role('input').val()).toBe(b64('round trip'));
            expect(role('output').val()).toBe('round trip');
            expect($root.find('[data-mode="decode"]').hasClass('is-active')).toBe(true);
            expect($root.find('[data-mode="encode"]').hasClass('is-active')).toBe(false);
            expect($root.find('[data-source="text"]').hasClass('is-active')).toBe(true);
        });

        it('flips back to encode from decode', () => {
            switchMode('decode');
            typeInput(b64('abc'));

            role('swap').trigger('click');

            expect($root.find('[data-mode="encode"]').hasClass('is-active')).toBe(true);
            expect(role('input').val()).toBe('abc');
            expect(role('output').val()).toBe(b64('abc'));
        });

        it('returns to the text source when swapping away from the file source', async () => {
            $root.find('[data-source="file"]').trigger('click');
            const input = role('file')[0];
            Object.defineProperty(input, 'files', {
                value: [{name: 'f', arrayBuffer: () => Promise.resolve(new TextEncoder().encode('file').buffer)}],
                configurable: true
            });
            $(input).trigger('change');
            await flush();

            role('swap').trigger('click');

            expect($root.find('[data-source="text"]').hasClass('is-active')).toBe(true);
            expect(role('input').val()).toBe(b64('file'));
            expect(role('output').val()).toBe('file');
        });

        it('does nothing for an empty output', () => {
            role('swap').trigger('click');

            expect($root.find('[data-mode="encode"]').hasClass('is-active')).toBe(true);
        });

        it('does nothing for a binary result', () => {
            switchMode('decode');
            typeInput(byte(0xFF, 0xFE, 0xFD));

            role('swap').trigger('click');

            expect($root.find('[data-mode="decode"]').hasClass('is-active')).toBe(true);
            expect(role('input').val()).toBe(byte(0xFF, 0xFE, 0xFD));
        });
    });

    describe('binary notice defaults', () => {
        it('describes an unknown size/type as 0 bytes of application/octet-stream', () => {
            create();

            component.showBinary(true);

            expect(role('binary-text').text())
                .toBe('aaxis.tools.base64.binary_notice {"size":0,"type":"application/octet-stream"}');
        });
    });

    describe('help', () => {
        it('opens a close-only modal with the help content', () => {
            create();
            const event = $.Event('click');

            role('help').trigger(event);

            expect(event.isDefaultPrevented()).toBe(true);
            expect(Modal.instances).toHaveLength(1);
            expect(Modal.instances[0].options).toMatchObject({
                title: 'aaxis.tools.base64.help',
                allowOk: false,
                cancelText: 'Close'
            });
            expect(Modal.instances[0].options.content).toContain('Help body');
            expect(Modal.instances[0].open).toHaveBeenCalledTimes(1);
        });
    });

    describe('dispose', () => {
        it('detaches every handler and cancels a pending conversion', () => {
            create();
            role('input').val('late').trigger('input');

            component.dispose();
            vi.advanceTimersByTime(500);

            expect(role('output').val()).toBe('');
            switchMode('decode');
            expect($root.find('[data-mode="decode"]').hasClass('is-active')).toBe(false);
            role('dropzone').trigger('dragover');
            expect(role('dropzone').hasClass('is-dragover')).toBe(false);
            expect(component.disposed).toBe(true);
        });

        it('is idempotent', () => {
            create();

            component.dispose();
            const off = vi.spyOn($root, 'off');
            component.dispose();

            expect(off).not.toHaveBeenCalled();
        });

        it('disposes cleanly when nothing was typed', () => {
            create();

            expect(() => component.dispose()).not.toThrow();
        });
    });
});
