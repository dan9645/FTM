// Elements
const configInput = document.getElementById('config-input');
const mappingInput = document.getElementById('mapping-input');
const applyMappingBtn = document.getElementById('apply-mapping-btn');
const triggerConfigUpload = document.getElementById('trigger-config-upload');
const ocrInput = document.getElementById('ocr-input');
const ocrBtn = document.getElementById('ocr-btn');
const ocrStatus = document.getElementById('ocr-status');
const fontInput = document.getElementById('font-input');
const fileCount = document.getElementById('file-count');
const generateBtn = document.getElementById('generate-btn');
const downloadBtn = document.getElementById('download-btn');
const previewGrid = document.getElementById('preview-grid');
const previewCount = document.getElementById('preview-count');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const fontUploadArea = document.getElementById('font-upload-area');

// State
let fontFiles = []; // Array of File objects
let fontMap = new Map(); // Map<filename, text>

// Event Listeners
configInput.addEventListener('change', handleConfigUpload);
triggerConfigUpload.addEventListener('click', (e) => {
    e.preventDefault();
    configInput.click();
});
applyMappingBtn.addEventListener('click', applyMappingFromTextarea);

// OCR Listeners
ocrBtn.addEventListener('click', () => ocrInput.click());
ocrInput.addEventListener('change', handleOcrUpload);

fontInput.addEventListener('change', handleFontUpload);
generateBtn.addEventListener('click', generateThumbnails);
downloadBtn.addEventListener('click', downloadZip);

// Drag and Drop
setupDragAndDrop(fontUploadArea, fontInput);
setupDragAndDrop(document.getElementById('mapping-area'), ocrInput, true); // Allow image drop on mapping area

function setupDragAndDrop(area, input, isImage = false) {
    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('drag-over');
    });

    area.addEventListener('dragleave', () => {
        area.classList.remove('drag-over');
    });

    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            if (isImage) {
                // If dropping image for OCR
                if (files[0].type.startsWith('image/')) {
                    input.files = files;
                    input.dispatchEvent(new Event('change'));
                }
            } else {
                // Fonts
                input.files = files;
                input.dispatchEvent(new Event('change'));
            }
        }
    });
}

function handleConfigUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target.result);
            processMappingData(json);
            // Also update the textarea to show what was loaded
            mappingInput.value = JSON.stringify(json, null, 2);
        } catch (err) {
            alert('Error: Invalid JSON file');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function applyMappingFromTextarea() {
    const text = mappingInput.value.trim();
    if (!text) {
        alert('Please paste some mapping data first.');
        return;
    }

    // Attempt to parse as JSON first
    try {
        const json = JSON.parse(text);
        processMappingData(json);
    } catch (e) {
        // Fallback to TSV/CSV
        processCSVMapping(text);
    }
}

function processMappingData(data) {
    // Determine format: array of {font, text} or object {font: text}
    if (Array.isArray(data)) {
        data.forEach(item => {
            if (item.font && item.text) {
                fontMap.set(item.font, item.text);
            }
        });
    } else if (typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
            fontMap.set(key, value);
        }
    }

    // If we have fonts loaded, update their displays immediately
    if (fontFiles.length > 0) {
        updatePreviewsWithNewMapping();
    } else {
        alert(`Mapping loaded. Added ${fontMap.size} entries.`);
    }
}

function processCSVMapping(text) {
    const lines = text.split(/\r?\n/);
    let count = 0;

    for (const line of lines) {
        if (!line.trim()) continue;

        // Try tab then comma
        let parts = line.split('\t');
        if (parts.length < 2) {
            parts = line.split(',');
        }

        if (parts.length >= 2) {
            const fontName = parts[0].trim();
            // Join the rest in case text contains separators
            const displayText = parts.slice(1).join(' ').trim();
            if (fontName && displayText) {
                fontMap.set(fontName, displayText);
                count++;
            }
        }
    }

    if (fontFiles.length > 0) {
        updatePreviewsWithNewMapping();
    } else {
        alert(`Mapping applied. Updated ${count} entries.`);
    }
}

async function handleOcrUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    ocrStatus.style.display = 'inline-block';
    ocrStatus.textContent = 'Initializing OCR...';
    ocrBtn.disabled = true;

    try {
        ocrStatus.textContent = 'Reading text...';

        const worker = await Tesseract.createWorker();
        await worker.loadLanguage('eng+kor+jpn'); // Detect common languages for fonts
        await worker.initialize('eng+kor+jpn');

        const { data: { text, lines } } = await worker.recognize(file);

        await worker.terminate();

        // Process OCR result
        let tsvOutput = '';
        let count = 0;

        // Naive parsing: Assume each line is "FontFilename [space/junk] Text"
        // We look for typical font extensions .ttf or .otf

        lines.forEach(line => {
            const lineText = line.text.trim();
            if (!lineText) return;

            // Find where the extension is
            // Regex to find .ttf or .otf (case insensitive)
            // match[0] is the extension, match.index is where it starts
            const match = lineText.match(/(\.ttf|\.otf)/i);

            if (match) {
                const extIndex = match.index + match[0].length;
                const filename = lineText.substring(0, extIndex).trim();
                // Everything after the filename is potentially the render text
                let renderText = lineText.substring(extIndex).trim();

                // Clean up render text (remove common OCR junk like leading hyphens or spaces)
                renderText = renderText.replace(/^[-_—\s]+/, '');

                if (filename && renderText) {
                    tsvOutput += `${filename}\t${renderText}\n`;
                    count++;
                }
            }
        });

        if (count === 0) {
            // Fallback: If no extensions found, maybe it's a raw table?
            // Just paste the raw text and let user edit
            tsvOutput = text;
            alert('No .ttf/.otf filenames detected. Pasting raw text.');
        }

        // Append or replace? Let's append if there's existing content, or replace?
        // User might be building a list. Let's append with newlines.
        const currentVal = mappingInput.value.trim();
        if (currentVal) {
            mappingInput.value = currentVal + '\n' + tsvOutput;
        } else {
            mappingInput.value = tsvOutput;
        }

        ocrStatus.textContent = `Found ${count} items`;
        setTimeout(() => {
            ocrStatus.style.display = 'none';
        }, 3000);

    } catch (err) {
        console.error(err);
        ocrStatus.textContent = 'Error during OCR';
        alert('Failed to read image. See console for details.');
    } finally {
        ocrBtn.disabled = false;
        ocrInput.value = ''; // Reset input
    }
}

function handleFontUpload(e) {
    // Add new files to existing ones or replace?
    // Let's replace for simplicity as per standard input behavior, 
    // or we could append. Standard is replace.
    fontFiles = Array.from(e.target.files).filter(f =>
        f.name.toLowerCase().endsWith('.ttf') || f.name.toLowerCase().endsWith('.otf')
    );

    fileCount.textContent = `${fontFiles.length} files selected`;

    if (fontFiles.length > 0) {
        generateBtn.disabled = false;
        fileCount.style.color = 'var(--accent-color)';
    } else {
        generateBtn.disabled = true;
        fileCount.style.color = 'var(--text-secondary)';
    }
}

function updatePreviewsWithNewMapping() {
    fontFiles.forEach(file => {
        const card = document.getElementById(`card-${file.name}`);
        if (card) {
            const input = card.querySelector('input');
            const newText = fontMap.get(file.name);
            if (newText) {
                input.value = newText;
                // Trigger update
                const fontName = file.name.split('.')[0];
                updateCardPreview(file.name, fontName, newText, card);
            }
        }
    });
}

async function generateThumbnails() {
    progressContainer.style.display = 'block';
    previewGrid.innerHTML = '';
    downloadBtn.disabled = true;
    generateBtn.disabled = true;

    let processedCount = 0;
    const total = fontFiles.length;

    for (const file of fontFiles) {
        try {
            updateProgress(processedCount, total, `Processing ${file.name}...`);
            await processSingleFont(file);
        } catch (err) {
            console.error(`Failed to process ${file.name}:`, err);
        }
        processedCount++;
    }

    updateProgress(total, total, 'Done!');
    setTimeout(() => {
        progressContainer.style.display = 'none';
        generateBtn.disabled = false;
        if (fontFiles.length > 0) {
            downloadBtn.disabled = false;
        }
    }, 1000);

    previewCount.textContent = `(${fontFiles.length})`;
}

async function processSingleFont(file) {
    const fontName = file.name.split('.')[0];

    // Determine initial text: Map -> Filename
    const initialText = fontMap.get(file.name) || fontName;

    // Load Font
    const buffer = await file.arrayBuffer();
    const fontFace = new FontFace(fontName, buffer);
    await fontFace.load();
    document.fonts.add(fontFace);

    // Create Card UI
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.id = `card-${file.name}`;

    // HTML structure
    card.innerHTML = `
        <div class="img-container"></div>
        <div class="preview-info">
            <div class="font-name" title="${file.name}">${file.name}</div>
            <input type="text" class="preview-input" value="${initialText}">
            <div class="font-size-info">128px Height</div>
        </div>
    `;
    previewGrid.appendChild(card);

    // Initial Render
    await updateCardPreview(file.name, fontName, initialText, card);

    // Live Editing Listener
    const input = card.querySelector('input');
    input.addEventListener('input', (e) => {
        const currentText = e.target.value;
        updateCardPreview(file.name, fontName, currentText, card);
    });
}

async function updateCardPreview(filename, fontName, text, cardElement) {
    const imgContainer = cardElement.querySelector('.img-container');

    // Render to DataURL
    // Use a small timeout to avoid blocking UI on each keystroke if fast typing?
    // For now, responsive enough.
    const imgDataUrl = await renderFontToImage(fontName, text);

    imgContainer.innerHTML = `<img src="${imgDataUrl}" alt="${filename}">`;
}

function updateProgress(current, total, text) {
    const percentage = total === 0 ? 0 : (current / total) * 100;
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `${text} (${Math.round(percentage)}%)`;
}

function renderFontToImage(fontFamily, text) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Initial render size (large enough)
        const fontSize = 150;
        ctx.font = `${fontSize}px "${fontFamily}"`;

        // Measure text
        const metrics = ctx.measureText(text || " "); // Ensure even empty text doesn't crash
        const textWidth = Math.ceil(metrics.width);
        const textHeight = Math.ceil(fontSize * 1.5); // Safe bounding height

        canvas.width = Math.max(textWidth + 100, 10); // Min width
        canvas.height = textHeight + 100;

        // Re-set font after resize
        ctx.font = `${fontSize}px "${fontFamily}"`;
        ctx.fillStyle = 'white';
        ctx.textBaseline = 'middle';

        // Clear and Draw
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (text) {
            ctx.fillText(text, 50, canvas.height / 2);
        }

        // Crop transparent pixels
        const cropped = cropCanvas(canvas);

        // Resize to 128px height
        const finalCanvas = document.createElement('canvas');
        const targetHeight = 128; // Fixed height requirement

        if (cropped.width === 0 || cropped.height === 0) {
            // Empty image
            finalCanvas.width = 1;
            finalCanvas.height = targetHeight;
        } else {
            const scaleFactor = targetHeight / cropped.height;
            const targetWidth = Math.round(cropped.width * scaleFactor);

            finalCanvas.width = targetWidth;
            finalCanvas.height = targetHeight;

            const finalCtx = finalCanvas.getContext('2d');
            finalCtx.imageSmoothingEnabled = true;
            finalCtx.imageSmoothingQuality = 'high';
            finalCtx.drawImage(cropped, 0, 0, targetWidth, targetHeight);
        }

        resolve(finalCanvas.toDataURL('image/png'));
    });
}

function cropCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    let found = false;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const index = (y * w + x) * 4;
            if (data[index + 3] > 0) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                found = true;
            }
        }
    }

    if (!found) return { width: 0, height: 0 };

    const w_crop = maxX - minX + 1;
    const h_crop = maxY - minY + 1;

    const cut = document.createElement('canvas');
    cut.width = w_crop;
    cut.height = h_crop;
    const cutCtx = cut.getContext('2d');
    cutCtx.drawImage(canvas, minX, minY, w_crop, h_crop, 0, 0, w_crop, h_crop);

    return cut;
}

// Update Download Logic to use CURRENT text in inputs
async function downloadZip() {
    if (fontFiles.length === 0) return;

    const zip = new JSZip();

    // We need to iterate over either the DOM elements or the original file list
    // and grab the *current* input value from the DOM.

    const promises = fontFiles.map(async (file) => {
        const card = document.getElementById(`card-${file.name}`);
        if (!card) return; // Should not happen

        const input = card.querySelector('input');
        const currentText = input.value;
        const fontName = file.name.split('.')[0];

        // Re-render specifically for the zip (in case state is stale, though it shouldn't be)
        // Or we could grab the image src blob?
        // Better to re-render to ensure fresh high-qual blob from the exact current text.

        const dataUrl = await renderFontToImage(fontName, currentText);

        // DataURL to Blob
        const blob = await (await fetch(dataUrl)).blob();
        zip.file(`${file.name}.png`, blob);
    });

    await Promise.all(promises);

    zip.generateAsync({ type: 'blob' }).then(function (content) {
        saveAs(content, 'font_thumbnails.zip');
    });
}
