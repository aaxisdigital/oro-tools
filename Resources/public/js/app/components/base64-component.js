import $ from 'jquery';
import __ from 'orotranslation/js/translator';
import messenger from 'oroui/js/messenger';
import Modal from 'oroui/js/modal';
import BaseComponent from 'oroui/js/app/components/base/component';

/**
 * Base64 converter (fully client-side, live).
 *
 * Encode: type text or drop/browse a file -> Base64 output updates as you go.
 * Decode: paste Base64 -> plain text when it decodes to valid UTF-8, otherwise a binary download.
 * The swap button moves the output back into the input and flips the direction.
 */
class Base64Component extends BaseComponent {
    initialize(options) {
        this.$el = options._sourceElement;
        this.mode = 'encode';
        this.source = 'text';
        this.fileBase64 = null;
        this.fileSize = 0;
        this.fileName = '';
        this.binaryBytes = null;

        this.$el.on('click.aaxisB64', '[data-role="mode"]', this.onModeClick.bind(this));
        this.$el.on('click.aaxisB64', '[data-role="source"]', this.onSourceClick.bind(this));
        this.$el.on('input.aaxisB64', '[data-role="input"]', this.onInput.bind(this));
        this.$el.on('click.aaxisB64', '[data-role="input-clear"]', this.onClear.bind(this));
        this.$el.on('click.aaxisB64', '[data-role="browse"]', this.onBrowse.bind(this));
        this.$el.on('change.aaxisB64', '[data-role="file"]', this.onFileChange.bind(this));
        this.$el.on('click.aaxisB64', '[data-role="copy"]', this.onCopy.bind(this));
        this.$el.on('click.aaxisB64', '[data-role="download"]', this.onDownload.bind(this));
        this.$el.on('click.aaxisB64', '[data-role="swap"]', this.onSwap.bind(this));
        this.$el.on('click.aaxisB64', '[data-role="help"]', this.onHelp.bind(this));

        this.bindDropzone();
        this.applyMode();
    }

    onHelp(event) {
        event.preventDefault();
        const modal = new Modal({
            title: __('aaxis.tools.base64.help'),
            content: this.$el.find('[data-role="help-content"]').html(),
            allowOk: false,
            cancelText: __('Close')
        });
        modal.open();
    }

    // --- Mode / source switching ------------------------------------------

    onModeClick(event) {
        const mode = $(event.currentTarget).data('mode');
        if (mode === this.mode) {
            return;
        }
        this.mode = mode;
        this.$el.find('[data-role="mode"]').removeClass('is-active');
        $(event.currentTarget).addClass('is-active');
        this.resetInput();
        this.applyMode();
    }

    onSourceClick(event) {
        const source = $(event.currentTarget).data('source');
        if (source === this.source) {
            return;
        }
        this.source = source;
        this.$el.find('[data-role="source"]').removeClass('is-active');
        $(event.currentTarget).addClass('is-active');
        this.resetInput();
        this.applyMode();
    }

    applyMode() {
        const isEncode = this.mode === 'encode';
        const isFile = isEncode && this.source === 'file';

        // The Text/File toggle only makes sense while encoding.
        this.$el.find('[data-role="source-toggle"]').toggle(isEncode);

        // Input area: textarea for text/base64, dropzone for files.
        this.$el.find('[data-role="input"]').prop('hidden', isFile)
            .attr('placeholder', isEncode
                ? __('aaxis.tools.base64.ph_encode_text')
                : __('aaxis.tools.base64.ph_decode'));
        this.$el.find('[data-role="dropzone"]').prop('hidden', !isFile);

        // Titles + hint.
        this.$el.find('[data-role="input-title"]').text(
            isEncode ? __('aaxis.tools.base64.input_text') : __('aaxis.tools.base64.input_base64'));
        this.$el.find('[data-role="output-title"]').text(
            isEncode ? __('aaxis.tools.base64.output_base64') : __('aaxis.tools.base64.output_text'));
        this.$el.find('[data-role="hint"]').text(
            isEncode ? __('aaxis.tools.base64.hint_encode') : __('aaxis.tools.base64.hint_decode'));
        this.$el.find('[data-role="output"]').attr('placeholder', __('aaxis.tools.base64.ph_output'));

        this.convert();
    }

    resetInput() {
        this.$el.find('[data-role="input"]').val('');
        this.fileBase64 = null;
        this.fileSize = 0;
        this.fileName = '';
        this.$el.find('[data-role="file-name"]').prop('hidden', true).text('');
        const fileInput = this.$el.find('[data-role="file"]')[0];
        if (fileInput) {
            fileInput.value = '';
        }
    }

    // --- Input handling ----------------------------------------------------

    onInput() {
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this._timer = setTimeout(() => this.convert(), 120);
    }

    onClear(event) {
        event.preventDefault();
        this.resetInput();
        this.convert();
    }

    onBrowse(event) {
        event.preventDefault();
        this.$el.find('[data-role="file"]').trigger('click');
    }

    onFileChange(event) {
        const file = event.currentTarget.files && event.currentTarget.files[0];
        if (file) {
            this.readFile(file);
        }
    }

    bindDropzone() {
        const $dz = this.$el.find('[data-role="dropzone"]');
        $dz.on('dragover.aaxisB64', (e) => {
            e.preventDefault();
            $dz.addClass('is-dragover');
        });
        $dz.on('dragleave.aaxisB64 dragend.aaxisB64', () => $dz.removeClass('is-dragover'));
        $dz.on('drop.aaxisB64', (e) => {
            e.preventDefault();
            $dz.removeClass('is-dragover');
            const dt = e.originalEvent.dataTransfer;
            if (dt && dt.files && dt.files.length) {
                this.readFile(dt.files[0]);
            }
        });
    }

    readFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            const bytes = new Uint8Array(reader.result);
            // Output pure Base64 (no data: prefix). The file type is recovered on decode by
            // sniffing the content, so the output stays clean and copy-friendly.
            this.fileBase64 = this.bytesToBase64(bytes);
            this.fileSize = bytes.length;
            this.fileName = file.name;
            this.$el.find('[data-role="file-name"]').prop('hidden', false).text(file.name);
            this.convert();
        };
        reader.onerror = () => messenger.notificationFlashMessage('error', __('aaxis.tools.base64.read_error'));
        reader.readAsArrayBuffer(file);
    }

    // --- Conversion --------------------------------------------------------

    convert() {
        this.clearError();
        this.binaryBytes = null;
        this.binaryMime = null;
        this.binaryExt = null;
        this.showBinary(false);
        this.toggleDownload(false);

        if (this.mode === 'encode') {
            this.runEncode();
        } else {
            this.runDecode();
        }
    }

    runEncode() {
        if (this.source === 'file') {
            if (this.fileBase64 === null) {
                this.setOutput('');
                this.setCounts(0, 0, 'bytes', 'chars');
                return;
            }
            this.setOutput(this.fileBase64);
            this.setCounts(this.fileSize, this.fileBase64.length, 'bytes', 'chars');
            return;
        }

        const text = String(this.$el.find('[data-role="input"]').val() || '');
        const bytes = new TextEncoder().encode(text);
        const b64 = this.bytesToBase64(bytes);
        this.setOutput(b64);
        this.setCounts(text.length, b64.length, 'chars', 'chars');
    }

    runDecode() {
        const raw = String(this.$el.find('[data-role="input"]').val() || '').trim();
        if (raw === '') {
            this.setOutput('');
            this.setCounts(0, 0, 'chars', 'chars');
            return;
        }

        const inCount = raw.replace(/\s+/g, '').length;
        let bytes;
        try {
            bytes = this.base64ToBytes(raw);
        } catch (e) {
            this.setOutput('');
            this.showError(__('aaxis.tools.base64.invalid'));
            this.setCounts(inCount, 0, 'chars', 'bytes');
            return;
        }

        const text = this.bytesToTextOrNull(bytes);
        if (text !== null) {
            this.setOutput(text);
            this.setCounts(inCount, text.length, 'chars', 'chars');
        } else {
            // Binary payload: detect the file type from its magic bytes for a sensible download.
            const sniffed = this.sniffType(bytes);
            this.binaryBytes = bytes;
            this.binaryMime = sniffed.mime;
            this.binaryExt = sniffed.ext;
            this.setOutput('');
            this.showBinary(true, bytes.length, sniffed.label);
            this.toggleDownload(true);
            this.setCounts(inCount, bytes.length, 'chars', 'bytes');
        }
    }

    // --- Output helpers ----------------------------------------------------

    setOutput(value) {
        this.$el.find('[data-role="output"]').val(value);
    }

    setCounts(inCount, outCount, inUnit, outUnit) {
        this.$el.find('[data-role="input-count"]').text(this.formatCount(inCount, inUnit));
        this.$el.find('[data-role="output-count"]').text(
            (outCount === 0 && this.binaryBytes === null && this.$el.find('[data-role="output"]').val() === '')
                ? ''
                : this.formatCount(outCount, outUnit));
    }

    formatCount(count, unit) {
        return unit === 'bytes'
            ? __('aaxis.tools.base64.count_bytes', {count: count})
            : __('aaxis.tools.base64.count_chars', {count: count});
    }

    showBinary(show, size, mime) {
        this.$el.find('[data-role="output"]').prop('hidden', !!show);
        this.$el.find('[data-role="binary"]').prop('hidden', !show);
        if (show) {
            this.$el.find('[data-role="binary-text"]').text(__('aaxis.tools.base64.binary_notice', {
                size: size || 0,
                type: mime || 'application/octet-stream'
            }));
        }
    }

    toggleDownload(show) {
        this.$el.find('[data-role="download"]').prop('hidden', !show);
    }

    showError(message) {
        this.$el.find('[data-role="error"]').prop('hidden', false).text(message);
    }

    clearError() {
        this.$el.find('[data-role="error"]').prop('hidden', true).text('');
    }

    // --- Actions -----------------------------------------------------------

    onCopy(event) {
        event.preventDefault();
        const value = String(this.$el.find('[data-role="output"]').val() || '');
        if (value === '') {
            return;
        }
        const ok = () => messenger.notificationFlashMessage('success', __('aaxis.tools.base64.copied'));
        const fail = () => messenger.notificationFlashMessage('error', __('aaxis.tools.base64.copy_error'));
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(ok).catch(fail);
        } else {
            fail();
        }
    }

    onDownload(event) {
        event.preventDefault();
        if (!this.binaryBytes) {
            return;
        }
        const mime = this.binaryMime || 'application/octet-stream';
        const blob = new Blob([this.binaryBytes], {type: mime});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'decoded.' + (this.binaryExt || 'bin');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    onSwap(event) {
        event.preventDefault();
        const output = String(this.$el.find('[data-role="output"]').val() || '');
        // Nothing to swap for an empty or binary result.
        if (output === '' || this.binaryBytes !== null) {
            return;
        }

        const nextMode = this.mode === 'encode' ? 'decode' : 'encode';
        this.mode = nextMode;
        this.source = 'text';
        this.$el.find('[data-role="mode"]').removeClass('is-active')
            .filter('[data-mode="' + nextMode + '"]').addClass('is-active');
        this.$el.find('[data-role="source"]').removeClass('is-active')
            .filter('[data-source="text"]').addClass('is-active');
        this.resetInput();
        this.$el.find('[data-role="input"]').val(output);
        this.applyMode();
    }

    // --- Base64 / UTF-8 helpers -------------------------------------------

    bytesToBase64(bytes) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    base64ToBytes(b64) {
        // Tolerate common real-world variations: surrounding whitespace/newlines, JSON-escaped
        // slashes ("\/"), URL-safe alphabet ("-"/"_") and missing "=" padding.
        let normalized = b64
            .replace(/\s+/g, '')
            .replace(/\\/g, '')
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .replace(/=+$/, '');
        const remainder = normalized.length % 4;
        if (remainder === 1) {
            throw new Error('invalid base64 length');
        }
        if (remainder > 0) {
            normalized += '='.repeat(4 - remainder);
        }
        const binary = atob(normalized); // throws on invalid characters
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    bytesToTextOrNull(bytes) {
        try {
            return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        } catch (e) {
            return null;
        }
    }

    /**
     * Detect a binary payload's type from its leading "magic" bytes so the download gets a
     * sensible name/extension. Falls back to a generic binary type when unknown.
     *
     * @return {{ext: string, mime: string, label: string}}
     */
    sniffType(bytes) {
        const starts = (sig, offset) => {
            const at = offset || 0;
            if (bytes.length < at + sig.length) {
                return false;
            }
            for (let i = 0; i < sig.length; i++) {
                if (bytes[at + i] !== sig[i]) {
                    return false;
                }
            }
            return true;
        };
        const ascii = (str, offset) => starts(str.split('').map(c => c.charCodeAt(0)), offset);

        if (ascii('%PDF')) {
            return {ext: 'pdf', mime: 'application/pdf', label: 'PDF document'};
        }
        if (starts([0x89, 0x50, 0x4E, 0x47])) {
            return {ext: 'png', mime: 'image/png', label: 'PNG image'};
        }
        if (starts([0xFF, 0xD8, 0xFF])) {
            return {ext: 'jpg', mime: 'image/jpeg', label: 'JPEG image'};
        }
        if (ascii('GIF8')) {
            return {ext: 'gif', mime: 'image/gif', label: 'GIF image'};
        }
        if (ascii('RIFF') && ascii('WEBP', 8)) {
            return {ext: 'webp', mime: 'image/webp', label: 'WebP image'};
        }
        if (ascii('RIFF') && ascii('WAVE', 8)) {
            return {ext: 'wav', mime: 'audio/wav', label: 'WAV audio'};
        }
        if (starts([0x42, 0x4D])) {
            return {ext: 'bmp', mime: 'image/bmp', label: 'BMP image'};
        }
        if (starts([0x1F, 0x8B])) {
            return {ext: 'gz', mime: 'application/gzip', label: 'GZIP archive'};
        }
        if (starts([0x50, 0x4B, 0x03, 0x04]) || starts([0x50, 0x4B, 0x05, 0x06])) {
            // Note: docx/xlsx/odt are ZIP containers and also match this signature.
            return {ext: 'zip', mime: 'application/zip', label: 'ZIP archive'};
        }
        if (ascii('ID3') || starts([0xFF, 0xFB])) {
            return {ext: 'mp3', mime: 'audio/mpeg', label: 'MP3 audio'};
        }
        if (ascii('OggS')) {
            return {ext: 'ogg', mime: 'audio/ogg', label: 'OGG media'};
        }
        if (starts([0x49, 0x49, 0x2A, 0x00]) || starts([0x4D, 0x4D, 0x00, 0x2A])) {
            return {ext: 'tif', mime: 'image/tiff', label: 'TIFF image'};
        }

        return {ext: 'bin', mime: 'application/octet-stream', label: 'binary'};
    }

    dispose() {
        if (this.disposed) {
            return;
        }
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this.$el.find('[data-role="dropzone"]').off('.aaxisB64');
        this.$el.off('.aaxisB64');
        super.dispose();
    }
}

export default Base64Component;
