import { toast } from "./components/Toast";
import { slipDestinations } from "./stations";

export function notifySlipPrint(
  print: { status?: string } | null | undefined,
  printed: string,
  notPrinted: string
) {
  if (print?.status === "printed") toast(printed, "info");
  else if (print?.status === "failed") toast(notPrinted, "err");
  else toast(notPrinted, "info");
}

export function notifyStationPrint(
  print: { status?: string } | null | undefined,
  slips?: { station?: string }[] | null,
  sent = "Sent"
) {
  const dest = slipDestinations(slips);
  if (print?.status === "printed") {
    toast(dest ? `${sent} · ${dest} printed` : `${sent} · slip printed`, "info");
    return;
  }
  if (print?.status === "failed") {
    toast(dest ? `${sent} · ${dest} printer failed` : `${sent} · printer failed`, "err");
    return;
  }
  toast(dest ? `${sent} · ${dest}` : sent, "info");
}
