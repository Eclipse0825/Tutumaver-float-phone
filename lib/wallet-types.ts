export type WalletCardStyle = "obsidian" | "graphite" | "silver";
export type WalletCurrency = "CNY" | "KRW" | "JPY" | "USD" | "EUR" | "HKD" | "TWD" | "AUD" | (string & {});

export type WalletCard = {
  id: string;
  title: string;
  bankLabel: string;
  maskedNumber: string;
  cardStyle: WalletCardStyle;
  balance: number;
  note: string;
  accentLabel: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WalletAccountType = "balance" | "card";

export type WalletTransactionKind = "transfer_in" | "transfer_out" | "payment" | "refund" | "adjustment" | "currency_exchange";

export type WalletTransaction = {
  id: string;
  cardId: string;
  accountType?: WalletAccountType;
  title: string;
  amount: number;
  kind: WalletTransactionKind;
  category: string;
  createdAt: string;
  detail: string;
  balanceAfter: number;
  relatedOrderId?: string;
  currency?: WalletCurrency;
  originalCurrency?: WalletCurrency;
  originalAmount?: number;
  exchangeRate?: number;
  exchangeToCurrency?: WalletCurrency;
  exchangeToAmount?: number;
  relatedMessageId?: string;
  source?: "generated" | "manual" | "app";
  credit?: boolean;
};

export type WalletFixedRule = {
  id: string; title: string; kind: "income" | "expense" | "debt"; currency: WalletCurrency;
  amount: number; day: number | "last"; startMonth: string; endMonth?: string; enabled: boolean;
  debtTarget?: "credit" | "loan"; principal?: number; principalPerPayment?: number;
};
export type WalletFixedSettlement = { status: "paid" | "pending" | "no_debt"; amount: number; at: string };
export type WalletReceipt = Pick<WalletTransaction,"id"|"amount"|"currency"|"kind"|"credit"|"cardId"|"accountType">;
export type WalletState = {
  financeEpoch?: string;
  resetAt?: string;
  fixedRules?: WalletFixedRule[];
  fixedSettlements?: Record<string, WalletFixedSettlement>;
  fixedDebtBalances?: Record<string, number>;
  processedReferences?: Record<string, WalletReceipt>;
  blockedMessageIds?: string[];
  balance: number;
  cards: WalletCard[];
  transactions: WalletTransaction[];
  defaultCardId: string;
  updatedAt: string;
  currencyBalances: Partial<Record<WalletCurrency, number>>;
  primaryCurrency: WalletCurrency;
  displayCurrency: WalletCurrency;
  autoConvertReceived: boolean;
  wealthLevel?: string;
  incomeSources?: string;
  generateLivingTransactions?: boolean;
  commonCurrencies?: WalletCurrency[];
  creditEnabled?: boolean;
  creditMaskedNumber?: string;
  creditDebts?: Partial<Record<WalletCurrency, number>>;
  lastLivingRefreshAt?: string;
  roleAssetsInitialized?: boolean;
};

export type WalletPaymentInput = {
  accountId?: string;
  cardId?: string;
  amount: number;
  title: string;
  detail: string;
  category?: string;
  relatedOrderId?: string;
};

export type WalletPaymentResult = {
  ok: boolean;
  state: WalletState;
  transaction?: WalletTransaction;
  error?: string;
};
