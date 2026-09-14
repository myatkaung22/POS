function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printSlip(title: string, content: string) {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: 80mm auto; margin: 3mm; }
      html, body {
        margin: 0;
        background: #fff;
        color: #111;
      }
      pre {
        font-family: "Courier New", Courier, ui-monospace, monospace;
        font-size: 11px;
        line-height: 1.2;
        white-space: pre-wrap;
        width: 74mm;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <pre>${escapeHtml(content)}</pre>
  </body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.srcdoc = html;
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2500);
  };
  document.body.appendChild(iframe);
}
