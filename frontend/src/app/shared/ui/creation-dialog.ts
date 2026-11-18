/** Native modal helpers shared by the two creation forms. */
export function openCreationDialog(dialog: HTMLDialogElement | undefined): void {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  dialog.querySelector<HTMLElement>('[autofocus]')?.focus();
}

export function containDialogFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget as HTMLDialogElement;
  const items = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((item) => item.getClientRects().length > 0);
  const first = items[0],
    last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
  } else if (
    event.shiftKey &&
    (document.activeElement === first || !dialog.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || !dialog.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}
