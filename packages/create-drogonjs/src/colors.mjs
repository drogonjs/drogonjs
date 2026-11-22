const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout.isTTY);

function wrap(open, close) {
  const start = `[${open}m`;
  const end = `[${close}m`;
  return (value) => (enabled ? `${start}${value}${end}` : String(value));
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const cyan = wrap(36, 39);
