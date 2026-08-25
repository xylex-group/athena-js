import { paint } from "./colors.ts";
import type { CliCapabilities } from "./types.ts";

export interface CliRail {
  bar: string;
  done: string;
  end: string;
  error: string;
  start: string;
  step: string;
  warn: string;
}

export function cliRail(interactive: boolean): CliRail {
  if (interactive) {
    return {
      bar: "│",
      done: "◇",
      end: "└",
      error: "■",
      start: "┌",
      step: "◆",
      warn: "▲",
    };
  }
  return {
    bar: "",
    done: "",
    end: "",
    error: "",
    start: "",
    step: "",
    warn: "",
  };
}

export function usesRail(capabilities: CliCapabilities): boolean {
  return capabilities.mode === "interactive";
}

export function railStart(
  title: string,
  capabilities: CliCapabilities
): string {
  const rail = cliRail(usesRail(capabilities));
  if (!rail.start) {
    return paint(title, "bold", capabilities);
  }
  return `${paint(rail.start, "dim", capabilities)}  ${paint(title, "bold", capabilities)}`;
}

export function railBar(
  text: string,
  capabilities: CliCapabilities
): string {
  const rail = cliRail(usesRail(capabilities));
  if (!rail.bar) {
    return text;
  }
  const bar = paint(rail.bar, "dim", capabilities);
  if (text.length === 0) {
    return bar;
  }
  return `${bar}  ${text}`;
}

export function railEnd(
  message: string,
  capabilities: CliCapabilities
): string {
  const rail = cliRail(usesRail(capabilities));
  if (!rail.end) {
    return message;
  }
  const end = paint(rail.end, "dim", capabilities);
  if (message.length === 0) {
    return end;
  }
  return `${end}  ${message}`;
}

export function railError(
  message: string,
  capabilities: CliCapabilities
): string {
  const rail = cliRail(usesRail(capabilities));
  const painted = paint(message, "red", capabilities);
  if (!rail.end) {
    return painted;
  }
  return `${paint(rail.end, "red", capabilities)}  ${paint(rail.error, "red", capabilities)}  ${painted}`;
}

/**
 * Wrap a multi-line block in the same ┌ │ └ session used by prompts.
 * No-ops in plain/json modes so scripts keep unframed text.
 */
export function frameBlock(
  text: string,
  capabilities: CliCapabilities
): string {
  if (!usesRail(capabilities)) {
    return text;
  }
  const lines = text.split("\n");
  const title = lines[0] ?? "";
  const rest = lines.slice(1);
  const framed = [railStart(title, capabilities)];
  for (const line of rest) {
    framed.push(railBar(line, capabilities));
  }
  framed.push(railEnd("", capabilities));
  return framed.join("\n");
}
