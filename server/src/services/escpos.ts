/**
 * Minimal ESC/POS encoder for 80mm receipt printers (raw TCP port 9100).
 * Only the commands needed for tickets and receipts are implemented.
 */
const ESC = 0x1b;
const GS = 0x1d;

export class EscPos {
  private readonly chunks: Buffer[] = [];

  constructor(private readonly width = 42) {
    this.chunks.push(Buffer.from([ESC, 0x40])); // initialise
  }

  align(mode: 'left' | 'center' | 'right'): this {
    this.chunks.push(Buffer.from([ESC, 0x61, mode === 'left' ? 0 : mode === 'center' ? 1 : 2]));
    return this;
  }

  bold(on: boolean): this {
    this.chunks.push(Buffer.from([ESC, 0x45, on ? 1 : 0]));
    return this;
  }

  /** Double height + width for headers. */
  big(on: boolean): this {
    this.chunks.push(Buffer.from([GS, 0x21, on ? 0x11 : 0x00]));
    return this;
  }

  line(text = ''): this {
    this.chunks.push(Buffer.from(`${text}\n`, 'latin1'));
    return this;
  }

  /** Two-column row: label left, value right, padded to the print width. */
  row(left: string, right: string): this {
    const space = Math.max(1, this.width - left.length - right.length);
    return this.line(`${left}${' '.repeat(space)}${right}`);
  }

  rule(char = '-'): this {
    return this.line(char.repeat(this.width));
  }

  feed(lines = 3): this {
    this.chunks.push(Buffer.from([ESC, 0x64, lines]));
    return this;
  }

  cut(): this {
    this.chunks.push(Buffer.from([GS, 0x56, 0x00]));
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
