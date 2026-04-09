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
        if (oEntity.Locked            === "X" ||
            oEntity.RandomMngApproval === "X" ||
            oEntity.AwaitingIbt       === "X") {
            return "manage";
        }
        if (oEntity.PickFinalized  === "X" ||
            oEntity.PackingStarted === "X") {
            return "packing";
        }
        return "picking";
    }

    return {

        /*------------------------------------------------------------------
          modifyStartupExtension
          Fires after OVP fully initialises — expands SmartFilterBar.
        ------------------------------------------------------------------*/
        modifyStartupExtension: function (oCustomSelectionVariant) {
            const oSFB = this.oGlobalFilter;
            if (oSFB && typeof oSFB.setFilterBarExpanded === "function") {
                oSFB.setFilterBarExpanded(true);
            }
            return oCustomSelectionVariant;
        },

        /*------------------------------------------------------------------
          doCustomNavigation
          Called by OVP on every card row/header click BEFORE navigation
          fires. Return a navigation entry object to override the default,
          or return nothing (undefined) to use the default.

          IMPORTANT:
          - Use oContext.sPath (not getPath()) — confirmed in SAP docs
          - Return nothing for non-delivery cards and header clicks
          - Common.SemanticObject must NOT be on DeliveryNumber in
            annotation.xml — that triggers a SmartLink disambiguation
            popup instead of calling this function
        ------------------------------------------------------------------*/
        doCustomNavigation: function (sCardId, oContext, oNavigationEntry) {

            // Header click (no row context) — use annotation default
            if (!oContext) {
                return;
            }

            // Only route the four delivery cards
            const aDeliveryCards = [
                "cardBreached", "cardAtRisk", "cardDueNextHour", "cardToDo"
            ];
            if (aDeliveryCards.indexOf(sCardId) === -1) {
                return;
            }

            // Read entity from context using sPath (confirmed correct by SAP docs)
            const oEntity = oContext.getProperty(oContext.sPath);
            if (!oEntity) {
                return;
            }

            const sAction = _resolveAction(oEntity);

            return {
                type:           "com.sap.vocabularies.UI.v1.DataFieldForIntentBasedNavigation",
                semanticObject: "custdel",
                action:         sAction,
                url:            "",   // required by OVP even for intent navigation
                label:          ""    // optional
            };
        }

    };
});