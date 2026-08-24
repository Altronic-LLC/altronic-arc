// Entry point for the sample generator's bundle — re-exports the app modules
// the script needs, so it runs the real builders rather than a copy.
export {
  MOCK_OPEN_ORDER_LINES,
  MOCK_OPEN_ORDER_ACCOUNTS,
  MOCK_RUN_DATE,
} from "@/data/openOrdersMockData";
export {
  buildMasterWorkbook,
  buildCustomerWorkbook,
  customerReportsFor,
} from "@/lib/openOrdersWorkbook";
export {
  masterWorkbookName,
  customerWorkbookName,
  weekFolderName,
} from "@/lib/openOrders";
