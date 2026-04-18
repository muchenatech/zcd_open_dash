@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Slot Assigned value help'
@ObjectModel.resultSet.sizeCategory: #XS
@ObjectModel.usageType: { serviceQuality: #X, sizeCategory: #S, dataClass: #MIXED }

define view entity zcds_cdp_has_slot_vh
  as select distinct from zconstants
{
  @ObjectModel.text.element: ['HasSlotText']
  @UI.textArrangement: #TEXT_ONLY
  @UI.lineItem: [{ position: 10 }]
  
  key  case when sequence = '001' then 'X' else '' end as HasSlot,

  @Semantics.text: true
  @UI.lineItem: [{ position: 20 }]
  
    case when sequence = '001' then 'With Slot' else 'Without Slot' end as HasSlotText
}
where const_type = 'DASHBOARD'
  and field_name = 'LEADTIMES'
  and sequence  <= '002'
