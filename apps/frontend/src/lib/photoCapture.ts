// Read an image File (from an <input type="file" accept="image/*" capture>)
// and downscale it to a JPEG data URI so it can be stored inline (photoUrl /
// photoProofUrl) without any external file storage. Used by the incident report
// and service-request/ticket forms for on-scene "Take Photo" documentation.
export function downscaleImage(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the photo"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(String(reader.result)); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(String(reader.result)); // fall back to the raw data URI
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
