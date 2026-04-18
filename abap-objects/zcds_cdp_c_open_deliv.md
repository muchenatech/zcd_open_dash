@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Open deliveries  - consumption view'
@Metadata.allowExtensions: true
@ObjectModel.usageType:{
    serviceQuality: #X,
    sizeCategory: #S,
    dataClass: #MIXED
}
define view entity zcds_cdp_c_open_deliv as select from zcds_cdp_open_deliv_tf
{
    key vbeln                   as DeliveryNumber,
      @UI.selectionField: [{ position: 10 }]
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZCDS_CDP_STORE_VH', element: 'Store' } }]
      werks                   as Store,
      werks_name              as StoreName,
      
      @UI.selectionField: [{ position: 20 }]
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZCDS_CDP_VSTEL_VH', element: 'Vstel' } }]
      vstel                   as Vstel,
      
      @UI.selectionField: [{ position: 30 }]
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZCDS_CDP_HAS_SLOT_VH', element: 'HasSlot' } }]
      has_slot                as HasSlot,
      
      vbeln_au                as OrderNumber,
      auart                   as Auart,
      kunnr                   as Kunnr,
      ihrez                   as Ihrez,
      bolnr                   as Bolnr,
      wadat                   as Wadat,
      wadatDisplay            as WadatDisplay,
      --@Semantics.time: true
      del_window_start        as DelWindowStart,
      --@Semantics.time: true
      del_window_end          as DelWindowEnd,
      status                  as Status,
      statusText              as StatusText,
      lifsk                   as Lifsk,
      pkstk                   as Pkstk,
      kostk                   as Kostk,
      wbstk                   as Wbstk,
      locked                  as Locked,
      lock_user               as LockUser,
      lock_timestamp          as LockTimestamp,
      on_hold                 as OnHold,
      picking_started         as PickingStarted,
      fully_picked            as FullyPicked,
      packing_started         as PackingStarted,
      fully_packed            as FullyPacked,
      fully_issued            as FullyIssued,
      pick_finalized          as PickFinalized,
      awaiting_ibt            as AwaitingIbt,
      random_mng_approval     as RandomMngApproval,
      refunds_mng_approval    as RefundsMngApproval,
      slotDisplay             as SlotDisplay,
      
      risk_bucket             as RiskBucket,
      risk_criticality        as RiskCriticality,
      minutes_to_slot         as MinutesToSlot
}
