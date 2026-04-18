@EndUserText.label: 'Open Deliveries'
define service Zcdp_open_deliv_srv {
  expose zcds_cdp_c_open_deliv     as OpenDeliverySet;
  expose zcds_cdp_store_vh         as StoreValueHelp;
  expose ZCDS_CDP_VSTEL_VH         as ShippingPointHelp;
  expose zcds_cdp_has_slot_vh      as SlotValueHelp;
  expose zcds_cdp_c_slot_count     as SlotCountSet;
  expose zcds_cdp_dashboard_config as DashboardConfigSet;
}