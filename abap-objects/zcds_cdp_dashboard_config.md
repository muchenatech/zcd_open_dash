@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Dashboard config from ZCONSTANTS'
@ObjectModel.resultSet.sizeCategory: #XS
@ObjectModel.usageType: { serviceQuality: #X, sizeCategory: #S, dataClass: #MIXED }

define view entity zcds_cdp_dashboard_config
  as select from zconstants
{
  key const_type  as ConstType,
  key field_name  as FieldName,
  key sequence    as Sequence,
      field_value as FieldValue,
      description as Description
}
where const_type = 'DASHBOARD'
