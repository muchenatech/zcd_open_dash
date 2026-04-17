sap.ui.define([], function () {
    "use strict";

    /*----------------------------------------------------------------------
      Private: resolve which app action based on delivery status flags.
      FDS Section 4 priority order:
        1. Management: Locked / RandomMngApproval / AwaitingIbt
        2. Packing:    PickFinalized / PackingStarted
        3. Picking:    everything else (default)
    ----------------------------------------------------------------------*/
    function _resolveAction(oEntity) {
        if (oEntity.Locked === "X" ||
            oEntity.RandomMngApproval === "X" ||
            oEntity.AwaitingIbt === "X") {
            return "manage";
        }
        if (oEntity.PickFinalized === "X" ||
            oEntity.PackingStarted === "X") {
            return "packing";
        }
        return "picking";
    }

    /*----------------------------------------------------------------------
      Private: schedule a recurring model refresh every iSeconds seconds.
      Calls oModel.refresh(true) which re-fires all bound OData requests,
      updating all card data simultaneously.
    ----------------------------------------------------------------------*/
    function _scheduleRefresh(oModel, iSeconds) {
        if (!oModel || iSeconds <= 0) {
            return;
        }
        setInterval(function () {
            try {
                oModel.refresh(true);
            } catch (e) {
                // Non-fatal: card data updates on the next tick.
            }
        }, iSeconds * 1000);
    }

    /*----------------------------------------------------------------------
      Private: read REFRESH interval from ZCONSTANTS via DashboardConfig.
      Falls back to 60 seconds if read fails or returns no data.
    ----------------------------------------------------------------------*/
    function _startAutoRefresh(oModel) {
        if (!oModel) {
            return;
        }

        let iDefaultSeconds = 60;

        _scheduleRefresh(oModel, iDefaultSeconds);

        oModel.read("/DashboardConfigSet", {
            filters: [
                new sap.ui.model.Filter("FieldName", "EQ", "REFRESH")
            ],
            success: function (oData) {
                let iSeconds = iDefaultSeconds;
                const aResults = (oData && oData.results) || [];
                if (aResults.length > 0) {
                    const iParsed = parseInt(aResults[0].FieldValue, 10);
                    if (!isNaN(iParsed) && iParsed > 0) {
                        iSeconds = iParsed;
                    }
                }
                _scheduleRefresh(oModel, iSeconds);
            },
            error: function () {
                _scheduleRefresh(oModel, iDefaultSeconds);
            }
        });
    }

    function _applyStartupLogicOnce() {
        if (this._bStartupApplied) {
            return;
        }
        this._bStartupApplied = true;

        let oSFB = this.oGlobalFilter;
        if (oSFB && typeof oSFB.setFilterBarExpanded === "function") {
            oSFB.setFilterBarExpanded(true);
        }

        const oModel = this.getView ? this.getView().getModel("mainModel") : null;
        _startAutoRefresh(oModel || sap.ui.getCore().getModel("mainModel"));
    }

    function _handleStartupExtension(oCustomSelectionVariant) {
        _applyStartupLogicOnce.call(this);

        return oCustomSelectionVariant;
    }

    function _handleNavigation(sCardId, oContext) {
        if (!oContext) {
            return;
        }

        const aDeliveryCards = [
            "cardBreached", "cardAtRisk", "cardDueNextHour", "cardToDo"
        ];
        if (aDeliveryCards.indexOf(sCardId) === -1) {
            return;
        }

        const oEntity = oContext.getProperty(oContext.sPath);
        if (!oEntity) {
            return;
        }

        const sAction = _resolveAction(oEntity);

        return {
            type: "com.sap.vocabularies.UI.v1.DataFieldForIntentBasedNavigation",
            semanticObject: "custdel",
            action: sAction,
            url: "",
            label: ""
        };
    }

    return {
        onAfterRendering: function () {
            // Guaranteed app lifecycle hook for OVP main controller extension.
            // Use this for "run on app launch" behavior.
            _applyStartupLogicOnce.call(this);
        },

        /*------------------------------------------------------------------
          Legacy OVP hook.
        ------------------------------------------------------------------*/
        modifyStartupExtension: function (oCustomSelectionVariant) {
            return _handleStartupExtension.call(this, oCustomSelectionVariant);
        },

        /*------------------------------------------------------------------
          Newer OVP hook used on current S/4HANA stacks.
        ------------------------------------------------------------------*/
        provideStartupExtension: function (oCustomSelectionVariant) {
            return _handleStartupExtension.call(this, oCustomSelectionVariant);
        },

        /*------------------------------------------------------------------
          Legacy OVP navigation hook.
        ------------------------------------------------------------------*/
        doCustomNavigation: function (sCardId, oContext, oNavigationEntry) {
            return _handleNavigation(sCardId, oContext, oNavigationEntry);
        },

        /*------------------------------------------------------------------
          Newer OVP navigation hook.
        ------------------------------------------------------------------*/
        provideExtensionNavigation: function (sCardId, oContext, oNavigationEntry) {
            return _handleNavigation(sCardId, oContext, oNavigationEntry);
        }

    };
});
