export function renderAuthEmailFragment(
  fragment: string,
  variables: Record<string, string>
): string {
  let rendered = fragment;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
    rendered = rendered.split(`{{ ${key} }}`).join(value);
  }
  return rendered;
}
