@Metadata.layer: #CUSTOMER

@UI.headerInfo: {
  typeName:       'Delivery',
  typeNamePlural: 'Deliveries'
}

@UI.selectionVariant: [
  { qualifier: 'Breached'    },
  { qualifier: 'AtRisk'      },
  { qualifier: 'DueNextHour' },
  { qualifier: 'ToDo'        }
]
annotate view zcds_cdp_c_open_deliv
    with 
{
    @UI.lineItem: [
    { qualifier: 'Breached',    position: 10, value: 'DeliveryNumber', label: 'Delivery'    },
    { qualifier: 'Breached',    position: 20, value: 'StatusText',   label: 'Status',
      criticality: 'RiskCriticality', criticalityRepresentation: #WITHOUT_ICON              },  
    { qualifier: 'Breached',    position: 30, value: 'SlotDisplay', label: 'Slot'  },
    { qualifier: 'Breached',    position: 40, value: 'WadatDisplay',      label: 'Del. Date'       },
    
    { qualifier: 'AtRisk',    position: 10, value: 'DeliveryNumber', label: 'Delivery'    },
    { qualifier: 'AtRisk',    position: 20, value: 'StatusText',   label: 'Status',
      criticality: 'RiskCriticality', criticalityRepresentation: #WITHOUT_ICON              },  
    { qualifier: 'AtRisk',    position: 30, value: 'SlotDisplay', label: 'Slot'  },
    { qualifier: 'AtRisk',    position: 40, value: 'WadatDisplay',      label: 'Del. Date'       },
    { qualifier: 'DueNextHour', position: 10, value: 'DeliveryNumber'                       },
    { qualifier: 'DueNextHour', position: 20, value: 'StoreName'                            },
    { qualifier: 'DueNextHour', position: 30, value: 'DelWindowStart', label: 'Slot Start'  },
    { qualifier: 'DueNextHour', position: 40, value: 'MinutesToSlot',  label: 'Mins to Slot'},
    { qualifier: 'ToDo',        position: 10, value: 'DeliveryNumber'                       },
    { qualifier: 'ToDo',        position: 20, value: 'Wadat',          label: 'Del. Date'     },
    { qualifier: 'ToDo',        position: 30, value: 'DelWindowStart', label: 'Slot Start'  },
    { qualifier: 'ToDo',        position: 40, value: 'DelWindowEnd', label: 'Slot End'  },
    { qualifier: 'ToDo',        position: 50, value: 'StatusText',         label: 'Status',
      criticality: 'RiskCriticality', criticalityRepresentation: #WITHOUT_ICON              }
    
  ]
 
  DeliveryNumber;

  @UI.lineItem: [{ position: 10, qualifier: 'All' }]
  @UI.identification: [{ position: 10 }]
  @EndUserText.label: 'Store'
  Store;
  
  @EndUserText.label: 'Fullfillment Via'
  Vstel;

  @UI.lineItem: [{ position: 20, qualifier: 'All',
    criticality: 'RiskCriticality', criticalityRepresentation: #WITHOUT_ICON }]
  RiskBucket;

  @UI.lineItem: [{ position: 30, qualifier: 'All' }]
  @UI.identification: [{ position: 10 }]
  @EndUserText.label: 'Slot Assigned'
  HasSlot;
 
  @UI.lineItem: [{ position: 70 }]
  MinutesToSlot;   
}