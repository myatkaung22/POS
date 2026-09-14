import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "print-raw.ps1");

export type WindowsPrinter = {
  name: string;
  portName: string;
  driverName: string;
};

function safePrinterName(name: string) {
  const value = String(name || "").trim();
  if (!value || /[;&|`$<>]/.test(value)) throw new Error("Invalid printer name");
  return value;
}

async function runPowerShell(command: string, timeout = 15000) {
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { windowsHide: true, timeout }
  );
  return { stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
}

export async function ensureUsbPosPrinter() {
  if (process.platform !== "win32") return;
  const command = `
$usb = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USBPRINT*' -and $_.Status -eq 'OK' } | Select-Object -First 1
if (-not $usb) { return }
$port = (Get-PrinterPort | Where-Object { $_.Name -like 'USB*' } | Select-Object -First 1).Name
if (-not $port) { return }
$name = if ($usb.FriendlyName -match 'POS-58') { 'POS-58' } elseif ($usb.FriendlyName -match 'POS-80') { 'POS-80' } else { 'POS-USB' }
$existing = Get-Printer -Name $name -ErrorAction SilentlyContinue
if ($existing) { return }
Add-PrinterDriver -Name 'Generic / Text Only' -ErrorAction SilentlyContinue
Add-Printer -Name $name -DriverName 'Generic / Text Only' -PortName $port
`;
  try {
    await runPowerShell(command, 20000);
  } catch {
    /* queue may already exist or need admin */
  }
}

export async function listWindowsPrinters(): Promise<WindowsPrinter[]> {
  if (process.platform !== "win32") return [];
  await ensureUsbPosPrinter();
  try {
    const { stdout } = await runPowerShell(
      "Get-Printer | Select-Object Name, PortName, DriverName | ConvertTo-Json -Compress"
    );
    const parsed = JSON.parse(stdout || "[]");
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return rows
      .map((row: { Name?: string; PortName?: string; DriverName?: string }) => ({
        name: String(row.Name || "").trim(),
        portName: String(row.PortName || ""),
        driverName: String(row.DriverName || ""),
      }))
      .filter((row) => row.name)
      .filter((row) => !/onenote|print to pdf|fax|xps/i.test(row.name))
      .sort((a, b) => Number(/^USB/i.test(b.portName)) - Number(/^USB/i.test(a.portName)));
  } catch {
    return [];
  }
}

async function printerPort(name: string) {
  try {
    const { stdout } = await runPowerShell(`(Get-Printer -Name '${name.replace(/'/g, "''")}').PortName`);
    return stdout;
  } catch {
    return "";
  }
}

async function copyToPort(file: string, port: string) {
  await execFileAsync("cmd.exe", ["/c", "copy", "/b", file, port], { windowsHide: true, timeout: 8000 });
}

export async function sendWindowsRaw(printerName: string, payload: Buffer) {
  if (process.platform !== "win32") throw new Error("USB printing is available on the POS Windows PC");
  const name = safePrinterName(printerName);
  const file = path.join(os.tmpdir(), `omnimind-pos-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
  await writeFile(file, payload);
  try {
    try {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-PrinterName", name, "-FilePath", file],
        { windowsHide: true, timeout: 15000 }
      );
      return;
    } catch {
      const port = (await printerPort(name)) || "USB001";
      await copyToPort(file, port);
    }
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

export function paperWidthForPrinter(name: string) {
  return /58/.test(name) ? 32 : 42;
}
