@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Today''s Slot order count'
@Metadata.allowExtensions: true
@ObjectModel.usageType:{
    serviceQuality: #X,
    sizeCategory: #S,
    dataClass: #MIXED
}
define view entity zcds_cdp_c_slot_count 
  as select from zcds_cdp_slot_count_tf
{ 
  key slot as Slot,
  delivery_count                                  as DeliveryCount,
  breached_count                                  as BreachedCount,
  atrisk_count                                    as AtRiskCount,

    -- Red (1) when slot has any breached deliveries, else Green (5)
    case
      when breached_count > 0 then cast(1 as abap.int1)
      else                         cast(5 as abap.int1)
    end                                             as BreachedCriticality,

    -- Amber (2) when slot has any at-risk deliveries, else Green (5)
    case
      when atrisk_count > 0 then cast(2 as abap.int1)
      else                       cast(5 as abap.int1)
    end                                             as AtRiskCriticality,

  -- SlotRiskCriticality: 1=Red (has breached), 2=Orange (at risk), 5=Green
  case
    when breached_count > 0 then cast(1 as abap.int1)
    when atrisk_count   > 0 then cast(2 as abap.int1)
    else                         cast(5 as abap.int1)
   end as SlotRiskCriticality
}                                            
    