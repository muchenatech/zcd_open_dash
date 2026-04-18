@EndUserText.label: 'Slot order count table function'
@ClientHandling.type: #CLIENT_INDEPENDENT
define table function zcds_cdp_slot_count_tf
returns {
  mandt           : mandt;
  slot            : abap.char(20);
  delivery_count  : abap.int4;
  breached_count  : abap.int4;
  atrisk_count    : abap.int4;
  
}
implemented by method zcl_cdp_open_deliv_amdp=>get_slot_counts;