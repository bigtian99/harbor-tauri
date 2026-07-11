//! 结算单领域类型。

use serde::Serialize;

#[derive(Debug, Clone)]
pub(crate) struct ChannelData {
    pub(crate) channel_id: String,
    pub(crate) account: String,
    pub(crate) name: String,
    pub(crate) bank: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AccountData {
    pub(crate) account: String,
    pub(crate) name: String,
    pub(crate) bank: String,
    pub(crate) channels: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct SettlementData {
    pub(crate) settlement_period: String,
    pub(crate) product_name: String,
    pub(crate) unit_price: f64,
    pub(crate) quantity: f64,
    pub(crate) amount: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct SettlementLine {
    pub(crate) channel_id: String,
    pub(crate) data: Option<SettlementData>,
}

#[derive(Debug, Serialize)]
pub struct SettlementGenerateResult {
    pub created: usize,
    pub accounts: usize,
    pub channels: usize,
    pub output_dir: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SettlementProgressPayload {
    pub(crate) percent: u8,
    pub(crate) message: String,
    pub(crate) current: usize,
    pub(crate) total: usize,
}
