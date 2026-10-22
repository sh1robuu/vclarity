import { reportSchema, type Report } from '@vclarity/shared';
const key = (tabId: number) => `report:${tabId}`;
export async function readReport(tabId: number): Promise<Report | null> {
  const stored = await chrome.storage.session.get(key(tabId));
  const result = reportSchema.safeParse(stored[key(tabId)]);
  return result.success ? result.data : null;
}
export async function writeReport(report: Report): Promise<void> {
  await chrome.storage.session.set({ [key(report.tabId)]: reportSchema.parse(report) });
}
export async function removeReport(tabId: number): Promise<void> { await chrome.storage.session.remove(key(tabId)); }
