@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Shipping point value help'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
    serviceQuality: #X,
    sizeCategory: #S,
    dataClass: #MIXED
}
define view entity ZCDS_CDP_VSTEL_VH
  as select from zcdp_shippt as a
    inner join   tvstt       as b on a.vstel = b.vstel
{
      @ObjectModel.text.element: ['vtext']
      @UI.textArrangement: #TEXT_ONLY
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.8
      @Search.ranking: #HIGH
  key a.vstel as Vstel,

      @Semantics.text: true
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.8
      @Search.ranking: #HIGH
      b.vtext
}
where
  b.spras = 'E'
