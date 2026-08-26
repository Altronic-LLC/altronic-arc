// Entry point for the sample generator's bundle — re-exports the app modules
// the scripts need, so they run the real parser and builders rather than a copy.
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
  metricsFor,
  customerRollup,
  isRepairLine,
} from "@/lib/openOrders";
export { readOpenOrdersWorkbook } from "@/lib/openOrdersExcel";
export { parseOpenOrdersGrid, OpenOrdersParseError } from "@/lib/openOrdersParse";
export { layoutFromColumns } from "@/lib/openOrdersFields";
