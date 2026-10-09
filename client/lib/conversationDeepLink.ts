/** Build Conversations deep links for SMS compose / dial by phone. */
export function conversationsComposeUrl(opts: {
  phone: string;
  name?: string | null;
}): string {
  const p = new URLSearchParams();
  p.set("compose", "1");
  p.set("phone", opts.phone.trim());
  const name = opts.name?.trim();
  if (name) p.set("name", name);
  return `/admin/conversations?${p.toString()}`;
}

export function conversationsDialUrl(opts: { phone: string }): string {
  const p = new URLSearchParams();
  p.set("dial", "1");
  p.set("phone", opts.phone.trim());
  return `/admin/conversations?${p.toString()}`;
}
