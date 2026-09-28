export interface ChatSearchCursor {
  createdAt: string;
  id: string;
}

export function encodeChatSearchCursor(cursor: ChatSearchCursor): string {
  return `${cursor.createdAt}|${cursor.id}`;
}

export function decodeChatSearchCursor(
  value: string | null | undefined
): ChatSearchCursor | undefined {
  if (!value) {
    return;
  }
  const separator = value.indexOf("|");
  if (separator <= 0 || separator === value.length - 1) {
    return;
  }
  try {
    const createdAt = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
      return;
    }
    return { createdAt, id };
  } catch (error) {
    if (error instanceof URIError) {
      return;
    }
    throw error;
  }
}
