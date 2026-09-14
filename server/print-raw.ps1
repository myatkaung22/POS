param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath
)

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "Print file not found"
}

$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DocInfo di);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void Send(string printer, string path) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) {
      throw new Exception("OpenPrinter failed " + Marshal.GetLastWin32Error());
    }
    var di = new DocInfo();
    di.pDocName = "OmniMind POS";
    di.pDataType = "RAW";
    try {
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter failed " + Marshal.GetLastWin32Error());
      StartPagePrinter(h);
      byte[] bytes = File.ReadAllBytes(path);
      IntPtr p = Marshal.AllocHGlobal(bytes.Length);
      Marshal.Copy(bytes, 0, p, bytes.Length);
      int written;
      bool ok = WritePrinter(h, p, bytes.Length, out written);
      Marshal.FreeHGlobal(p);
      EndPagePrinter(h);
      EndDocPrinter(h);
      if (!ok) throw new Exception("WritePrinter failed " + Marshal.GetLastWin32Error());
    }
    finally {
      ClosePrinter(h);
    }
  }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
[RawPrint]::Send($PrinterName, $FilePath)
