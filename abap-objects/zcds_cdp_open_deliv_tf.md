@EndUserText.label: 'Open deliveries table function'
@ClientHandling.type: #CLIENT_INDEPENDENT
define table function zcds_cdp_open_deliv_tf
returns {
  mandt               : mandt;
  vbeln                : vbeln_vl;
  werks                : werks_d;
  werks_name           : name1;
  vstel                : vstel;
  vbeln_au             : vbeln_va;
  auart                : auart;
  kunnr                : kunnr;
  ihrez                : ihrez;
  bolnr                : bolnr;
  wadat                : wadat;
  wadatDisplay         : abap.char(10);
  del_window_start     : abap.char(8);   --zzwindow_start;
  del_window_end       : abap.char(8); --zzwindow_end;
  status               : abap.char(1);
  statusText           : abap.char(60);
  lifsk                : lifsk;
  pkstk                : pkstk;
  kostk                : kostk;
  wbstk                : wbstk;
  locked               : abap.char(1);
  lock_user            : uname;
  lock_timestamp       : timestamp;
  on_hold              : abap.char(1);
  picking_started      : abap.char(1);
  fully_picked         : abap.char(1);
  packing_started      : abap.char(1);
  fully_packed         : abap.char(1);
  fully_issued         : abap.char(1);
  pick_finalized       : abap.char(1);
  finalized            : abap.char(1);
  awaiting_ibt         : abap.char(1);
  random_mng_approval  : abap.char(1);
  refunds_mng_approval : abap.char(1);
  slotDisplay          : abap.char(20);
  has_slot             : abap.char(1);
  minutes_to_slot      : abap.int4;
  risk_bucket          : abap.char(20);
  risk_criticality     : abap.int1;
  
}
implemented by method zcl_cdp_open_deliv_amdp=>get_open_deliveries_tf;