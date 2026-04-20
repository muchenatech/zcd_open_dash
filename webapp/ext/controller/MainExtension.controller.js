sap.ui.define([
    "sap/m/MessageBox",
    "sap/ui/model/odata/v2/ODataModel"
], function (MessageBox, ODataModel) {
    "use strict";

    const STORE_ASSIGNMENT_ERROR = "User not assigned to store/site";
    const USER_PARAM_STORE_ID = "ZSITE";
    const USER_SERVICE_URL = "/sap/opu/odata/sap/ZGW_USER_SRV/";

    /*----------------------------------------------------------------------
      Private: resolve which app action based on delivery status flags.
      FDS Section 4 priority order:
        1. Management: RandomMngApproval / AwaitingIbt
        2. Packing:    PickFinalized / PackingStarted
        3. Picking:    everything else (default)
    ----------------------------------------------------------------------*/
    function _resolveAction(oEntity) {
        if (oEntity.RandomMngApproval === "X" ||
            oEntity.RefundsMngApproval === "X" ||
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

    function _selectionVariantHasStore(oCustomSelectionVariant) {
        if (!oCustomSelectionVariant ||
            typeof oCustomSelectionVariant.getSelectOption !== "function") {
            return false;
        }

        const aStoreOptions = oCustomSelectionVariant.getSelectOption("Store");
        return Array.isArray(aStoreOptions) && aStoreOptions.length > 0;
    }

    function _applyDefaultStoreToSelectionVariant(oCustomSelectionVariant, sStore) {
        if (!oCustomSelectionVariant ||
            typeof oCustomSelectionVariant.addSelectOption !== "function" ||
            _selectionVariantHasStore(oCustomSelectionVariant)) {
            return false;
        }

        if (!sStore || !sStore.trim()) {
            return false;
        }

        oCustomSelectionVariant.addSelectOption("Store", "I", "EQ", sStore);
        return true;
    }

    function _filterDataHasStore(oFilterData) {
        if (!oFilterData || !oFilterData.Store) {
            return false;
        }

        // String form and token/range form are both considered "set".
        if (typeof oFilterData.Store === "string") {
            return oFilterData.Store.trim().length > 0;
        }

        const aItems = oFilterData.Store.items || [];
        const aRanges = oFilterData.Store.ranges || [];
        return aItems.length > 0 || aRanges.length > 0;
    }

    function _getUserModel(oController) {
        if (oController && oController._oResolvedUserModel) {
            return oController._oResolvedUserModel;
        }

        const oView = oController && typeof oController.getView === "function"
            ? oController.getView()
            : null;
        const oOwnerComponent = oController && typeof oController.getOwnerComponent === "function"
            ? oController.getOwnerComponent()
            : null;

        const oUserModel =
            (oView && oView.getModel("user")) ||
            (oOwnerComponent && oOwnerComponent.getModel("user")) ||
            sap.ui.getCore().getModel("user");

        if (oUserModel) {
            if (oController) {
                oController._oResolvedUserModel = oUserModel;
            }
            return oUserModel;
        }

        // FLP fallback: create user OData model if manifest model isn't attached yet.
        const oFallbackUserModel = new ODataModel(USER_SERVICE_URL, {
            useBatch: false
        });
        if (oController) {
            oController._oResolvedUserModel = oFallbackUserModel;
        }
        return oFallbackUserModel;
    }

    function _showStoreAssignmentErrorOnce(oController) {
        if (oController && oController._bStoreAssignmentErrorShown) {
            return;
        }
        if (oController) {
            oController._bStoreAssignmentErrorShown = true;
        }
        MessageBox.error(STORE_ASSIGNMENT_ERROR);
    }

    function _readUserAssignedStore(oController) {
        if (oController && oController._pUserAssignedStore) {
            return oController._pUserAssignedStore;
        }

        const oUserModel = _getUserModel(oController);
        if (!oUserModel || typeof oUserModel.read !== "function") {
            return Promise.reject(new Error(STORE_ASSIGNMENT_ERROR));
        }

        const pAssignedStore = new Promise(function (resolve, reject) {
            oUserModel.read("/Users('$myself')", {
                urlParameters: {
                    "$expand": "Parameters"
                },
                success: function (oData) {
                    const aParams = (((oData || {}).Parameters || {}).results) || [];
                    const oStoreParam = aParams.find(function (oParam) {
                        return oParam && oParam.ParameterID === USER_PARAM_STORE_ID;
                    });
                    const sAssignedStore = oStoreParam && oStoreParam.ParameterValue;
                    if (!sAssignedStore || !sAssignedStore.trim()) {
                        reject(new Error(STORE_ASSIGNMENT_ERROR));
                        return;
                    }
                    resolve(sAssignedStore.trim());
                },
                error: function () {
                    reject(new Error(STORE_ASSIGNMENT_ERROR));
                }
            });
        });

        if (oController) {
            oController._pUserAssignedStore = pAssignedStore;
        }
        return pAssignedStore;
    }

    function _applyResolvedStoreToFilterBar(oController) {
        if (!oController || oController._bResolvedStoreAttempted) {
            return;
        }
        oController._bResolvedStoreAttempted = true;

        _readUserAssignedStore(oController).then(function (sStore) {
            const oSFB = oController.oGlobalFilter;
            if (!oSFB ||
                typeof oSFB.getFilterData !== "function" ||
                typeof oSFB.setFilterData !== "function") {
                return;
            }

            const oFilterData = oSFB.getFilterData() || {};
            const bHasStore = _filterDataHasStore(oFilterData);
            if (bHasStore) {
                return;
            }

            oSFB.setFilterData({
                Store: {
                    ranges: [{
                        exclude: false,
                        operation: "EQ",
                        keyField: "Store",
                        value1: sStore
                    }]
                }
            }, true);

            if (typeof oSFB.search === "function") {
                oSFB.search();
            } else if (typeof oSFB.fireSearch === "function") {
                oSFB.fireSearch();
            }
        }).catch(function () {
            _showStoreAssignmentErrorOnce(oController);
        });
    }

    function _applyStartupLogicOnce() {
        if (this._bStartupApplied) {
            return;
        }

        const oSFB = this.oGlobalFilter;
        if (!oSFB || typeof oSFB.setFilterBarExpanded !== "function") {
            // Global filter may not be available on the earliest startup hook.
            // Keep retrying on later hooks/renders until we can expand it.
            return;
        }

        oSFB.setFilterBarExpanded(true);
        _applyResolvedStoreToFilterBar(this);
        this._bStartupApplied = true;

        if (!this._bAutoRefreshStarted) {
            this._bAutoRefreshStarted = true;
            const oModel = this.getView ? this.getView().getModel("mainModel") : null;
            _startAutoRefresh(oModel || sap.ui.getCore().getModel("mainModel"));
        }
    }

    function _handleStartupExtension(oCustomSelectionVariant) {
        const oController = this;
        _readUserAssignedStore(oController).then(function (sStore) {
            _applyDefaultStoreToSelectionVariant(oCustomSelectionVariant, sStore);
        }).catch(function () {
            _showStoreAssignmentErrorOnce(oController);
        });
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
