# Open Delivery Dashboard — Implementation Guide
### SAP Fiori Overview Page | AMDP Table Function Architecture | S/4HANA 2023

---

## How to Use This Guide

This is the **company implementation guide** for building SAP Fiori Overview Page (OVP)
dashboards backed by HANA AMDP Table Functions. Every step, every object name, and every
annotation rule has been **confirmed in production** on S/4HANA 2023 FPS01.

Follow the steps **in order**. Each step ends with a checklist. Do not proceed to the
next step until the checklist passes.

---

## Object Inventory

| Layer | Object Name | Type | Purpose |
|-------|-------------|------|---------|
| HANA Computation | `ZCL_CDP_OPEN_DELIV_AMDP` | ABAP Class | AMDP — risk bucket logic in HANA SQLScript |
| CDS Table Function | `ZCDS_CDP_OPEN_DELIV_TF` | CDS Table Function | Bridges main AMDP to CDS / OData layer |
| Consumption View | `ZCDS_CDP_C_OPEN_DELIV` | CDS View Entity | OData delivery entity with filter annotations |
| Metadata Extension | `ZCDS_CDP_C_OPEN_DELIV` | DDLX | UI line item and navigation annotations |
| Store Value Help | `ZCDS_CDP_STORE_VH` | CDS View Entity | Site dropdown in SmartFilterBar |
| Shipping Point VH | `ZCDS_CDP_VSTEL_VH` | CDS View Entity | Shipping Point dropdown |
| Slot Assigned VH | `ZCDS_CDP_HAS_SLOT_VH` | CDS View Entity | Slot assignment dropdown |
| Slot Count TF | `ZCDS_CDP_SLOT_COUNT_TF` | CDS Table Function | Bridges slot count method to CDS layer — implemented in `ZCL_CDP_OPEN_DELIV_AMDP` |
| Slot Count View | `ZCDS_CDP_C_SLOT_COUNT` | CDS View Entity | OData entity for card 5 slot summary |
| Slot Count DDLX | `ZCDS_CDP_C_SLOT_COUNT` | DDLX | UI annotations for slot count card |
| Dashboard Config View | `ZCDS_CDP_DASHBOARD_CONFIG` | CDS View Entity | Exposes dashboard constants from `ZCONSTANTS` |
| Service Definition | `ZCDP_OPEN_DELIV_SRV_DEF` | CDS | Exposes all entities as OData sets |
| Service Binding | `ZCDP_OPEN_DELIV_BIND` | OData V2 UI | Publishes `ZCDP_OPEN_DELIV_SRV` |
| Controller Extension | `MainExtension.controller.js` | JS | Expands SmartFilterBar on page load |
| Fiori App | `ZCDPOPENDASH` | Fiori Tools | OVP app with 5 cards + row navigation |

---

## Architecture

```
SmartFilterBar (Store / Shipping Point / Order Type)
        │ Go button → $filter appended to all card requests
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  Card 1: Breached    │  Card 2: At Risk   │  Card 3: Due Next Hr  │
│  Card 4: To Do       │  Card 5: Today Slot Order Count            │
└───────────────────────────────────────────────────────────────────┘
        │ Cards 1-4                              │ Card 5
        ▼                                        ▼
ZCDS_CDP_C_OPEN_DELIV                   ZCDS_CDP_C_SLOT_COUNT
(EntitySet: OpenDeliverySet)            (EntitySet: SlotCountSet)
        │                                        │
        ▼                                        ▼
ZCDS_CDP_OPEN_DELIV_TF                  ZCDS_CDP_SLOT_COUNT_TF
        │                                        │
        ▼                                        ▼
ZCL_CDP_OPEN_DELIV_AMDP─────────────────────────┘
  ├── get_open_deliveries_tf   (risk bucket per delivery)
  └── get_slot_counts          (count per slot, with risk state)
        │
        ▼
  HANA Column Store
  WHERE risk_bucket = 'BREACHED'
  AND werks = 'A001'  ← $filter works ✓
```

**Why AMDP instead of RAP virtual elements:** Virtual elements are computed by ABAP *after*
the database SELECT. When OVP sends `$filter=RiskBucket eq 'BREACHED'`, SADL translates it
into a WHERE clause *before* rows reach ABAP — so `RiskBucket` is blank at filter time and
all cards return the same data. An AMDP runs entirely inside HANA, making `RiskBucket` a
real computed column that WHERE clauses can filter correctly.

---

## Activation Order

> ⚠️ **Critical:** Each AMDP class must be active before its CDS Table Function.
> The Table Function must be active before the Consumption View that selects from it.

| Step | Object | Action |
|------|--------|--------|
| 1 | `ZCL_CDP_OPEN_DELIV_AMDP` | **Create + Activate FIRST** |
| 2 | `ZCDS_CDP_OPEN_DELIV_TF` | Create + Activate |
| 3 | `ZCDS_CDP_STORE_VH` | Create + Activate |
| 4 | `ZCDS_CDP_VSTEL_VH` | Create + Activate |
| 5 | `ZCDS_CDP_C_OPEN_DELIV` | Create + Activate |
| 6 | `ZCDS_CDP_C_OPEN_DELIV` DDLX | Create + Activate |
| 7 | `ZCDS_CDP_SLOT_COUNT_TF` | Create + Activate (method is in `ZCL_CDP_OPEN_DELIV_AMDP` — already active) |
| 8 | `ZCDS_CDP_C_SLOT_COUNT` | Create + Activate |
| 9 | `ZCDS_CDP_C_SLOT_COUNT` DDLX | Create + Activate |
| 10 | Service Definition `ZCDP_OPEN_DELIV_SRV_DEF` | Create + Activate |
| 11 | Service Binding `ZCDP_OPEN_DELIV_BIND` | Create → Publish Local |
| 12 | `annotation.xml` | Deploy to Fiori app |
| 13 | `manifest.json` | Deploy to Fiori app |
| 14 | `MainExtension.controller.js` | Deploy to `webapp/ext/controller/` |

---

## Step 1 — AMDP: ZCL_CDP_OPEN_DELIV_AMDP

**In ADT:** New → ABAP Class → `ZCL_CDP_OPEN_DELIV_AMDP`

Implements `IF_AMDP_MARKER_HDB`. **Activate before creating the Table Function.**

### Risk Bucket Logic

Lead times are read dynamically from `ZCONSTANTS` — changing them takes effect immediately
without any code change:

```
ZCONSTANTS: CONST_TYPE='DASHBOARD', FIELD_NAME='LEADTIMES'
  FIELD_VALUE='BREACH' ? DESCRIPTION = breach threshold in minutes  (e.g. 17)
  FIELD_VALUE='RISK'   ? DESCRIPTION = risk window in minutes       (e.g. 20)
  At Risk combined     = BREACH + RISK                              (e.g. 37)
```

Priority order — first matching rule wins:

| Priority | Condition | Bucket | Criticality |
|----------|-----------|--------|-------------|
| 1 | `lifsk IN ('OH','ZR','ZE')` — management hold | TODO | Green (5) |
| 2 | No slot AND `wadat < TODAY - 2 days` | BREACHED | Red (1) |
| 3 | No slot AND `wadat >= TODAY - 2 days` | TODO | Green (5) |
| 4 | Has slot AND `wadat < TODAY` | BREACHED | Red (1) |
| 5 | Has slot AND `wadat > TODAY` | TODO | Green (5) |
| 6 | Has slot, today AND `mins_to_slot ≤ BREACH` | BREACHED | Red (1) |
| 7 | Has slot, today AND `mins_to_slot ≤ BREACH+RISK` | ATRISK | Orange (2) |
| 8 | Has slot, today AND `slot_hour = HOUR(NOW+1hr)` | DUENEXTHOUR | Yellow (3) |
| 9 | Everything else | TODO | Green (5) |

```abap
CLASS zcl_cdp_open_deliv_amdp DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
  INTERFACES if_amdp_marker_hdb.

  CLASS-METHODS get_open_deliveries_tf FOR TABLE FUNCTION zcds_cdp_open_deliv_tf.
  CLASS-METHODS get_slot_counts FOR TABLE FUNCTION zcds_cdp_slot_count_tf.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.



CLASS zcl_cdp_open_deliv_amdp IMPLEMENTATION.
  METHOD get_open_deliveries_tf BY DATABASE FUNCTION FOR HDB
    LANGUAGE SQLSCRIPT
    OPTIONS READ-ONLY
    USING likp lips vbak t001w  tvls tvakt zconstants
          zcdp_shippt zcdp_ordtypes zcdp_ddellock.

    DECLARE lv_breach_mins INTEGER DEFAULT 17;
    DECLARE lv_atrisk_mins INTEGER DEFAULT 37;

    SELECT
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'BREACH'
                 THEN TO_INTEGER( description )
               END ), 17 ),
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'BREACH'
                 THEN TO_INTEGER( description )
               END ), 17 )
        +
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'RISK'
                 THEN TO_INTEGER( description )
               END ), 20 )
      INTO lv_breach_mins, lv_atrisk_mins
      FROM zconstants
  WHERE const_type = 'DASHBOARD'
    AND field_name = 'LEADTIMES';

      lt_base = SELECT
        likp.mandt,
        likp.vbeln,
        likp.vstel,
        likp.wadat,
        likp.erdat,
        likp.erzet,
        likp.bolnr,
        likp.kostk,
        likp.wbstk,
        likp.pkstk,
        likp.lifsk,

        vbak.ihrez,
        lips.werks,
        t1.name1                                              AS werks_name,
        vbak.vbeln                                            AS vbeln_au,
        vbak.auart,
        vbak.kunnr,
        tvakt.bezei,
        lck.uname                                             AS lock_user,
        lck.timestamp as lock_timestamp,

        CASE WHEN lck.uname IS NULL THEN '' ELSE 'X' END      AS locked,
        CASE likp.lifsk WHEN 'OH' THEN 'X' ELSE '' END        AS on_hold,
        CASE likp.lifsk WHEN 'ZR' THEN 'X' ELSE '' END        AS random_mng_approval,
        CASE likp.lifsk WHEN 'ZE' THEN 'X' ELSE '' END        AS refunds_mng_approval,
        CASE likp.kostk WHEN 'B'  THEN 'X' ELSE '' END        AS picking_started,
        CASE WHEN likp.pkstk IN ('B','D') THEN 'X' ELSE '' END AS packing_started,
        CASE likp.pkstk WHEN 'C'  THEN 'X' ELSE '' END        AS fully_packed,
        CASE likp.kostk WHEN 'C'  THEN 'X' ELSE '' END        AS fully_picked,
        CASE likp.wbstk WHEN 'C'  THEN 'X' ELSE '' END        AS fully_issued,
        CASE likp.lifsk WHEN 'Z0' THEN 'X' ELSE '' END        AS pick_finalized,
        CASE likp.lifsk WHEN 'Z1' THEN 'X' ELSE '' END        AS finalized,
        CASE likp.lifsk WHEN 'Z2' THEN 'X' ELSE '' END        AS awaiting_ibt,

        -- Uniform status code (domain ZCDP_DOM_CUST_DEL_STATE, values 0-A)
        CASE
          WHEN likp.lifsk = 'OH'             THEN '8' -- 'On Hold'
          WHEN likp.lifsk = 'ZR'             THEN '9' -- 'Random mng_approval'
          WHEN likp.lifsk = 'ZE'             THEN 'A' -- 'Refunds mng approval'
          WHEN likp.wbstk = 'C'             THEN '6' -- 'Fully Packed'
          WHEN lck.uname  IS NOT NULL        THEN '1' -- 'Locked'
          WHEN likp.lifsk = 'Z1'             THEN '5' -- 'Finalized'
          WHEN likp.lifsk = 'Z2'             THEN '7' -- 'Awaiting IBT'
          WHEN likp.pkstk IN ('B','D')   THEN '4' -- 'Packing Started'
          WHEN likp.lifsk = 'Z0'             THEN '3'
          WHEN likp.kostk = 'B'             THEN '2'
          ELSE                                    '0'
        END                                                   AS status,

        vbak.del_window_start,
        vbak.del_window_end,
        RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) AS dws_norm,

        CASE
          WHEN RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) <> '000000'
           AND RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) IS NOT NULL
           AND RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) <> ''
          THEN CAST(
                 SUBSTRING( TO_NVARCHAR( wadat ), 1, 8 )
                 || RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' )
               AS NVARCHAR(14) )
          ELSE NULL
        END AS slot_ts

        FROM likp

      INNER JOIN zcdp_shippt                                   -- registered shipping points only
        ON  zcdp_shippt.vstel = likp.vstel

      INNER JOIN lips
        ON  lips.vbeln  = likp.vbeln
        AND lips.pstyv <> 'YTAX'                              -- replicates zcds_delivery WHERE

      INNER JOIN vbak
        ON  vbak.vbeln  = lips.vgbel

      INNER JOIN zcdp_ordtypes                                 -- registered order types only
        ON  zcdp_ordtypes.auart = vbak.auart

      LEFT OUTER JOIN t001w AS t1
        ON  t1.werks    = lips.werks

      LEFT OUTER JOIN tvls
        ON  tvls.lifsp  = likp.lifsk

      LEFT OUTER JOIN tvakt
        ON  tvakt.auart = vbak.auart
        AND tvakt.spras = SESSION_CONTEXT('LOCALE_SAP')

      LEFT OUTER JOIN zcdp_ddellock AS lck
        ON  lck.vbeln   = likp.vbeln

     WHERE lips.wbsta <> 'C'  --- likp.wadat >= ADD_DAYS( CURRENT_DATE, -200 )
     AND lips.vgtyp = 'C'
      GROUP BY likp.mandt,                                                -- mirrors zcds_delivery GROUP BY
        likp.vbeln, likp.vstel, likp.wadat, likp.erdat,
        likp.erzet, likp.bolnr,
        likp.kostk, likp.wbstk, likp.pkstk, likp.lifsk, likp.lifex,
        vbak.ihrez, lips.werks, t1.name1, vbak.vbeln, vbak.auart,
        vbak.kunnr, tvakt.bezei, lck.uname, lck.timestamp,
        vbak.del_window_start, vbak.del_window_end;

      lt_open = SELECT * FROM :lt_base
               WHERE fully_packed = ''
                 AND finalized    = '';

     lt_normalised = SELECT mandt,
        vbeln, werks, werks_name, vstel, vbeln_au, auart, kunnr, ihrez,
         bolnr, wadat, del_window_end, erdat, erzet, status, lifsk, pkstk, kostk,
        wbstk, locked, lock_user, lock_timestamp, on_hold, picking_started,
        fully_picked, packing_started, fully_packed, fully_issued,
        pick_finalized, finalized, awaiting_ibt, random_mng_approval,
        refunds_mng_approval,

        -- Original value for OData display only — not used in calculations
        del_window_start,

        -- dws_norm: pure 6-digit HHMMSS, colons stripped, padded to 6
        RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) AS dws_norm,

        -- has_slot computed once here to avoid repeating in RETURN SELECT
        -- has_slot
*        CASE
*          WHEN RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) IS NULL
*           OR ( RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) = '000000'
*           OR RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) = ''
*           OR del_window_start IS NULL
*           OR del_window_start = ''
*           OR del_window_start = '000000'
*          THEN '' ELSE 'X'
*        END AS has_slot,
         CASE
          WHEN RPAD( REPLACE( del_window_start,':','' ),6,'0' ) IS NOT NULL
           AND RPAD( REPLACE( del_window_start,':','' ),6,'0' ) <> '000000'
           AND RPAD( REPLACE( del_window_start,':','' ),6,'0' ) <> ''
          THEN 'X' ELSE ''
        END AS has_slot,

        -- slot_ts: HANA TIMESTAMP built from DATS date + integer seconds
        -- TO_DATE(wadat)  — single-arg, no format string, no longdate path
        -- ADD_SECONDS(DATE, INT) — pure arithmetic → TIMESTAMP
        CASE
          WHEN RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) IS NOT NULL
           AND RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) <> '000000'
           AND RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' ) <> ''
          THEN ADD_SECONDS(
                 TO_DATE( wadat ),
                 TO_INTEGER( SUBSTRING( RPAD( REPLACE( del_window_start,':','' ),6,'0' ), 1, 2 ) ) * 3600
               + TO_INTEGER( SUBSTRING( RPAD( REPLACE( del_window_start,':','' ),6,'0' ), 3, 2 ) ) * 60
               )
          ELSE NULL
        END AS slot_ts,

              -- erdat_ts: TIMESTAMP from delivery creation date + creation time
        -- Used for ZOLC breach logic: ERDAT < today OR (ERDAT = today AND age > 2 hours)
        ADD_SECONDS(
          TO_DATE( erdat ),
          TO_INTEGER( SUBSTRING( RPAD( REPLACE( erzet, ':', '' ), 6, '0' ), 1, 2 ) ) * 3600
        + TO_INTEGER( SUBSTRING( RPAD( REPLACE( erzet, ':', '' ), 6, '0' ), 3, 2 ) ) * 60
        + TO_INTEGER( SUBSTRING( RPAD( REPLACE( erzet, ':', '' ), 6, '0' ), 5, 2 ) )
        ) AS erdat_ts

      FROM :lt_open;

     /*==================================================================
      STEP 3  Risk bucket computation + RETURN
      HANA SECONDS_BETWEEN( NOW(), slot_timestamp ) gives signed minutes.
      Negative = slot already past = BREACHED.

      Slot timestamp: wadat (YYYYMMDD) concatenated with del_window_start (HHMMSS).

      Priority order (highest wins):
        1. Management holds (OH/ZR/ZE)   TODO (parked, not at risk)
        2. No slot + past wadat           BREACHED
        3. No slot + future/today wadat   TODO
        4. Has slot: threshold minutes    BREACHED / ATRISK / DUENEXTHOUR / TODO
    ==================================================================*/

    RETURN
      SELECT mandt,
          vbeln,
          werks,
          werks_name,
          vstel,
          vbeln_au,
          auart,
          kunnr,
          ihrez,
          bolnr,
          wadat,
          SUBSTRING(TO_NVARCHAR(wadat), 7, 2) || '.' ||   -- DD
            SUBSTRING(TO_NVARCHAR(wadat), 5, 2) || '.' ||   -- MM
            SUBSTRING(TO_NVARCHAR(wadat), 1, 4)              -- YYYY
            AS wadatDisplay,
          del_window_start,
          del_window_end,
          status,
          CASE
            WHEN lifsk = 'OH'           THEN 'On Hold'
            WHEN lifsk = 'ZR'           THEN 'Random Mng Approval'
            WHEN lifsk = 'ZE'           THEN 'Refunds Mng Approval'
            WHEN wbstk = 'C'            THEN 'Fully Issued'
            WHEN lock_user IS NOT NULL
             AND lock_user <> ''        THEN 'Picking Locked by User ' || lock_user
            WHEN lifsk = 'Z1'           THEN 'Finalised'
            WHEN lifsk = 'Z2'           THEN 'Awaiting IBT'
            WHEN pkstk IN ('B','D') THEN 'Packing Started'
            WHEN lifsk = 'Z0'           THEN 'Pick Finalised'
            WHEN kostk = 'B'            THEN 'Picking Started'
            ELSE                             'Awaiting Picking'
          END AS statusText,
          lifsk,
          pkstk,
          kostk,
          wbstk,
          locked,
          lock_user,
          lock_timestamp,

          on_hold,
          picking_started,
          fully_picked,
          packing_started,
          fully_packed,
          fully_issued,
          pick_finalized,
          finalized,
          awaiting_ibt,
          random_mng_approval,
          refunds_mng_approval,

          CASE
              WHEN del_window_start IS NOT NULL
               AND del_window_start <> ''
               AND del_window_start <> '00:00'
              THEN del_window_start || ' - ' || del_window_end
              ELSE ''
            END AS slotDisplay,



          -- has_slot: check normalised value for zero guard
*          CASE
*            WHEN dws_norm IS NOT NULL
*             AND dws_norm <> '000000'
*             AND dws_norm <> ''         THEN 'X'
*            ELSE                             ''
*          END AS has_slot,
          has_slot,

          -- minutes_to_slot: signed integer. Negative = past slot. NULL = no slot.
           CASE
            WHEN slot_ts IS NOT NULL
            THEN CAST( SECONDS_BETWEEN( NOW(), slot_ts ) / 60 AS INTEGER )
            ELSE NULL
          END AS minutes_to_slot,

          -- risk_bucket
         CASE
            -- Management holds: always TODO regardless of slot/date
            WHEN lifsk IN ('OH','ZR','ZE')
              THEN 'TODO'

            -- Priority 2: No slot + ZOLC shipping point (collection orders)
            -- FDS: breached if erdat < today, OR erdat = today AND age > 2 hours
            -- FDS: all remaining ZOLC no-slot deliveries = ATRISK
            WHEN has_slot <> 'X' AND vstel = 'ZOLC'
              THEN CASE
                     WHEN erdat < CURRENT_DATE
                       THEN 'BREACHED'
                     WHEN erdat = CURRENT_DATE
                      AND SECONDS_BETWEEN( erdat_ts, NOW() ) / 3600 >= 2
                       THEN 'BREACHED'
                     ELSE 'ATRISK'
                   END

           -- Priority 3: No slot + other shipping points
            -- Breached if GI date < system date - 2 days
            WHEN has_slot <> 'X'
              THEN CASE
                     WHEN wadat < ADD_DAYS( CURRENT_DATE, -2 ) THEN 'BREACHED'
                     ELSE 'TODO'
                   END

            -- Priority 4: Has slot + delivery date already past
            WHEN has_slot = 'X' AND wadat < CURRENT_DATE
              THEN 'BREACHED'

            -- Priority 5: Has slot + future delivery date
            WHEN has_slot = 'X' AND wadat > CURRENT_DATE
              THEN 'TODO'

            -- Has slot, today: minute-level thresholds
            -- Breached: now is within breach lead time of slot start
            WHEN has_slot = 'X' AND SECONDS_BETWEEN( NOW(), slot_ts ) / 60 <= :lv_breach_mins
              THEN 'BREACHED'

            -- At Risk: now is within combined lead time but outside breach window
            WHEN SECONDS_BETWEEN( NOW(), slot_ts ) / 60 <= :lv_atrisk_mins
              THEN 'ATRISK'

            -- Due Next Hour: slot falls in the next whole clock hour
            WHEN TO_INTEGER( SUBSTRING( dws_norm, 1, 2 ) )
                 = HOUR( ADD_SECONDS( NOW(), 3600 ) )
              THEN 'DUENEXTHOUR'

            ELSE 'TODO'
          END AS risk_bucket,

          -- risk_criticality: 1=Red  2=Orange  3=Yellow  5=Green
          CASE
            WHEN lifsk IN ('OH','ZR','ZE')  THEN 5
            WHEN slot_ts IS NULL
              THEN CASE WHEN wadat < CURRENT_DATE THEN 1 ELSE 5 END
            WHEN SECONDS_BETWEEN( NOW(), slot_ts ) / 60 <= 0   THEN 1
            WHEN SECONDS_BETWEEN( NOW(), slot_ts ) / 60 <= 20  THEN 2
            WHEN SECONDS_BETWEEN( NOW(), slot_ts ) / 60 <= 60  THEN 3
            ELSE                                                     5
          END AS risk_criticality
          FROM :lt_normalised;
         --where has_slot  = 'X';


  ENDMETHOD.

  METHOD get_slot_counts BY DATABASE FUNCTION FOR HDB
    LANGUAGE SQLSCRIPT
    OPTIONS READ-ONLY
    USING likp lips vbak zconstants zcdp_shippt zcdp_ordtypes.

    DECLARE lv_breach_mins INTEGER DEFAULT 17;
    DECLARE lv_atrisk_mins INTEGER DEFAULT 37;

    SELECT
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'BREACH'
                 THEN TO_INTEGER( description )
               END ), 17 ),
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'BREACH'
                 THEN TO_INTEGER( description )
               END ), 17 )
        +
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'RISK'
                 THEN TO_INTEGER( description )
               END ), 20 )
      INTO lv_breach_mins, lv_atrisk_mins
      FROM zconstants
    WHERE const_type = 'DASHBOARD'
    AND field_name = 'LEADTIMES';

    /*-- All deliveries for today with slots --*/
    lt_today = SELECT
        likp.mandt, lips.werks, likp.vstel, likp.vbeln,
        vbak.del_window_start, vbak.del_window_end,likp.lifsk, likp.wadat,
        RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) AS dws_norm,
        CASE
          WHEN RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) IS NOT NULL
           AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> '000000'
           AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> ''
          THEN ADD_SECONDS(
                 TO_DATE( likp.wadat ),
                 TO_INTEGER( SUBSTRING( RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ),1,2 ) ) * 3600
               + TO_INTEGER( SUBSTRING( RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ),3,2 ) ) * 60 )
          ELSE NULL
        END AS slot_ts,
        CASE
          WHEN RPAD( REPLACE( del_window_start,':','' ),6,'0' ) IS NOT NULL
           AND RPAD( REPLACE( del_window_start,':','' ),6,'0' ) <> '000000'
           AND RPAD( REPLACE( del_window_start,':','' ),6,'0' ) <> ''
          THEN 'X' ELSE ''
        END AS has_slot
      FROM likp
      INNER JOIN zcdp_shippt ON zcdp_shippt.vstel = likp.vstel
      INNER JOIN lips ON lips.vbeln = likp.vbeln AND lips.pstyv <> 'YTAX'
      INNER JOIN vbak ON vbak.vbeln = lips.vgbel
        AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> '000000'
        AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) IS NOT NULL
        AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> ''
      INNER JOIN zcdp_ordtypes ON zcdp_ordtypes.auart = vbak.auart
      WHERE likp.wadat = CURRENT_DATE   --- >= ADD_DAYS( CURRENT_DATE, -200 )
        AND likp.pkstk <> 'C'
        AND likp.lifsk <> 'Z1'

      GROUP BY likp.mandt, lips.werks, likp.vstel, likp.vbeln,
               vbak.del_window_start, vbak.del_window_end, likp.lifsk, likp.wadat;

    /*--Compute risk bucket per delivery --*/
    lt_bucketed = SELECT
        mandt, werks, vstel, del_window_start, dws_norm,
        concat(del_window_start, ' - ' || del_window_end) as slot,
        CASE
          WHEN lifsk IN ('OH','ZR','ZE')                              THEN 'TODO'
          WHEN slot_ts IS NULL                                        THEN 'TODO'
          WHEN wadat < CURRENT_DATE                                   THEN 'BREACHED'
          WHEN SECONDS_BETWEEN(NOW(),slot_ts)/60 <= :lv_breach_mins  THEN 'BREACHED'
          WHEN SECONDS_BETWEEN(NOW(),slot_ts)/60 <= :lv_atrisk_mins  THEN 'ATRISK'
          WHEN TO_INTEGER(SUBSTRING(dws_norm,1,2))
               = HOUR(ADD_SECONDS(NOW(),3600))                        THEN 'DUENEXTHOUR'
          ELSE                                                              'TODO'
        END AS risk_bucket
      FROM :lt_today
      WHERE has_slot = 'X';

    /*--Aggregate by slot start time --*/
    RETURN
      SELECT mandt,
          slot,                        --concat(del_window_start, ' - ' || del_window_end) as slot,
          COUNT(*)                                        AS delivery_count,
          SUM(CASE WHEN risk_bucket = 'BREACHED' THEN 1 ELSE 0 END) AS breached_count,
          SUM(CASE WHEN risk_bucket = 'ATRISK'   THEN 1 ELSE 0 END) AS atrisk_count
        FROM :lt_bucketed
        GROUP BY mandt, slot
        ORDER BY slot;


  ENDMETHOD.

ENDCLASS.
```

**Checklist:**
- [ ] Class activates without syntax errors
- [ ] `zconstants` is in the `USING` clause
- [ ] All `FROM :lt_xxx` references use the colon prefix

---

## Step 2 — CDS Table Function: ZCDS_CDP_OPEN_DELIV_TF

**In ADT:** New → Data Definition → template "Define Table Function"

```cds
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
```

**Checklist:**
- [ ] Activates without errors — "method not found" means AMDP class not yet active
- [ ] Field names match AMDP RETURN SELECT aliases exactly

---

## Step 3 — Value Help Views

### ZCDS_CDP_STORE_VH

```cds
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Store Value Help'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
    serviceQuality: #X,
    sizeCategory: #S,
    dataClass: #MIXED
}
define view entity zcds_cdp_store_vh as select from t001w
{
    @ObjectModel.text.element: ['StoreName']
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.8
      @Search.ranking: #HIGH
  key werks                                      as Store,
      @Semantics.text: true
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.8
      @Search.ranking: #HIGH
      cast(name1 as werks_name preserving type ) as StoreName
}
```

### ZCDS_CDP_VSTEL_VH

> The key alias is `Vstel` (capital V). The `element: 'Vstel'` in the
> consumption view `@Consumption.valueHelpDefinition` must match exactly.

```cds
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
```

### ZCDS_CDP_HAS_SLOT_VH

```cds
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
```

**Checklist:**
- [ ] All three value help views activate without errors
- [ ] `zcds_cdp_c_open_deliv` uses these exact names in `@Consumption.valueHelpDefinition`

---

## Step 4 — Consumption View: ZCDS_CDP_C_OPEN_DELIV

> **Critical:** `@UI.selectionField` and `@Consumption.valueHelpDefinition` for filter
> fields must be declared **here in the DDL only — never in the DDLX**. If the DDLX
> re-declares `@UI.selectionField` on these fields without `@Consumption.valueHelpDefinition`,
> the DDLX overwrites the DDL annotation and the value help popup stops working.

```cds
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
```

**Checklist:**
- [ ] Activates without errors
- [ ] `RiskBucket` is NOT a virtual element — it comes directly from the table function
- [ ] `@Consumption.valueHelpDefinition` is NOT duplicated in the DDLX

---

## Step 5 — Metadata Extension (DDLX): ZCDS_CDP_C_OPEN_DELIV

**In ADT:** Right-click consumption view → New Metadata Extension

> **Rules:**
> 1. Every element in `annotate view {}` must carry at least one annotation
> 2. `Store`, `Vstel`, `Auart` are NOT listed here for `@UI.selectionField`
> 3. `@UI.selectionVariant` qualifiers link to the `selectionAnnotationPath` in manifest.json
> 4. `@UI.identification` on `DeliveryNumber` enables row-level navigation to other apps

```ddlx
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
```

> **Launchpad configuration required for navigation:**
> In SPRO → SAP Fiori → Launchpad → Target Mappings, register:
> | Semantic Object | Action | App ID |
> |----------------|--------|--------|
> | `custdel` | `manage` | Management app |
> | `custdel` | `picking` | Picking app |
> | `custdel` | `packing` | Packing app |
>
> The `DeliveryNumber` key value is passed automatically as a navigation parameter.

**Checklist:**
- [ ] Activates without errors
- [ ] `DeliveryNumber` has only `@EndUserText.label` — no `@UI.identification` with `semanticObjectAction`
- [ ] `Store` and `Vstel` have no `@UI.selectionField` here

---

## Step 6 — Slot Count AMDP: get_slot_counts (in ZCL_CDP_OPEN_DELIV_AMDP)

> **Both table functions are implemented in the same class.**
> `get_slot_counts` is a second method on `ZCL_CDP_OPEN_DELIV_AMDP` — there is no
> separate `ZCL_CDP_SLOT_COUNT_AMDP` class. Add this method to the existing class
> alongside `get_open_deliveries_tf`.

Add to the `PUBLIC SECTION` of `ZCL_CDP_OPEN_DELIV_AMDP`:

```abap
CLASS-METHODS get_slot_counts FOR TABLE FUNCTION zcds_cdp_slot_count_tf.
```

Then add the implementation:

```abap
METHOD get_slot_counts BY DATABASE FUNCTION FOR HDB
    LANGUAGE SQLSCRIPT
    OPTIONS READ-ONLY
    USING likp lips vbak zconstants zcdp_shippt zcdp_ordtypes.

    DECLARE lv_breach_mins INTEGER DEFAULT 17;
    DECLARE lv_atrisk_mins INTEGER DEFAULT 37;

    SELECT
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'BREACH'
                 THEN TO_INTEGER( description )
               END ), 17 ),
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'BREACH'
                 THEN TO_INTEGER( description )
               END ), 17 )
        +
        COALESCE(
          MAX( CASE
                 WHEN field_value = 'RISK'
                 THEN TO_INTEGER( description )
               END ), 20 )
      INTO lv_breach_mins, lv_atrisk_mins
      FROM zconstants
    WHERE const_type = 'DASHBOARD'
    AND field_name = 'LEADTIMES';

    /*-- All deliveries for today with slots --*/
    lt_today = SELECT
        likp.mandt, lips.werks, likp.vstel, likp.vbeln,
        vbak.del_window_start, vbak.del_window_end,likp.lifsk, likp.wadat,
        RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) AS dws_norm,
        CASE
          WHEN RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) IS NOT NULL
           AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> '000000'
           AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> ''
          THEN ADD_SECONDS(
                 TO_DATE( likp.wadat ),
                 TO_INTEGER( SUBSTRING( RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ),1,2 ) ) * 3600
               + TO_INTEGER( SUBSTRING( RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ),3,2 ) ) * 60 )
          ELSE NULL
        END AS slot_ts,
        CASE
          WHEN RPAD( REPLACE( del_window_start,':','' ),6,'0' ) IS NOT NULL
           AND RPAD( REPLACE( del_window_start,':','' ),6,'0' ) <> '000000'
           AND RPAD( REPLACE( del_window_start,':','' ),6,'0' ) <> ''
          THEN 'X' ELSE ''
        END AS has_slot
      FROM likp
      INNER JOIN zcdp_shippt ON zcdp_shippt.vstel = likp.vstel
      INNER JOIN lips ON lips.vbeln = likp.vbeln AND lips.pstyv <> 'YTAX'
      INNER JOIN vbak ON vbak.vbeln = lips.vgbel
        AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> '000000'
        AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) IS NOT NULL
        AND RPAD( REPLACE( vbak.del_window_start,':','' ),6,'0' ) <> ''
      INNER JOIN zcdp_ordtypes ON zcdp_ordtypes.auart = vbak.auart
      WHERE likp.wadat = CURRENT_DATE   --- >= ADD_DAYS( CURRENT_DATE, -200 )
        AND likp.pkstk <> 'C'
        AND likp.lifsk <> 'Z1'

      GROUP BY likp.mandt, lips.werks, likp.vstel, likp.vbeln,
               vbak.del_window_start, vbak.del_window_end, likp.lifsk, likp.wadat;

    /*--Compute risk bucket per delivery --*/
    lt_bucketed = SELECT
        mandt, werks, vstel, del_window_start, dws_norm,
        concat(del_window_start, ' - ' || del_window_end) as slot,
        CASE
          WHEN lifsk IN ('OH','ZR','ZE')                              THEN 'TODO'
          WHEN slot_ts IS NULL                                        THEN 'TODO'
          WHEN wadat < CURRENT_DATE                                   THEN 'BREACHED'
          WHEN SECONDS_BETWEEN(NOW(),slot_ts)/60 <= :lv_breach_mins  THEN 'BREACHED'
          WHEN SECONDS_BETWEEN(NOW(),slot_ts)/60 <= :lv_atrisk_mins  THEN 'ATRISK'
          WHEN TO_INTEGER(SUBSTRING(dws_norm,1,2))
               = HOUR(ADD_SECONDS(NOW(),3600))                        THEN 'DUENEXTHOUR'
          ELSE                                                              'TODO'
        END AS risk_bucket
      FROM :lt_today
      WHERE has_slot = 'X';

    /*--Aggregate by slot start time --*/
    RETURN
      SELECT mandt,
          slot,                        --concat(del_window_start, ' - ' || del_window_end) as slot,
          COUNT(*)                                        AS delivery_count,
          SUM(CASE WHEN risk_bucket = 'BREACHED' THEN 1 ELSE 0 END) AS breached_count,
          SUM(CASE WHEN risk_bucket = 'ATRISK'   THEN 1 ELSE 0 END) AS atrisk_count
        FROM :lt_bucketed
        GROUP BY mandt, slot
        ORDER BY slot;


  ENDMETHOD.
```

**Checklist:**
- [ ] `CLASS-METHODS get_slot_counts FOR TABLE FUNCTION zcds_cdp_slot_count_tf` added to `PUBLIC SECTION`
- [ ] `USING` clause: `likp lips vbak zconstants zcdp_shippt zcdp_ordtypes` (no `zcdp_ddellock`)
- [ ] Class activates without syntax errors

---

## Step 7 — Slot Count Table Function: ZCDS_CDP_SLOT_COUNT_TF

> **Implemented by `ZCL_CDP_OPEN_DELIV_AMDP=>GET_SLOT_COUNTS`** — the same class as the
> main delivery table function. The `slot` field is a concatenated display string
> (`HH:MM - HH:MM`) produced by the AMDP, typed as `abap.char(20)` as defined in the
> latest table function object.

```cds
@EndUserText.label: 'Slot order count table function'
@ClientHandling.type: #CLIENT_INDEPENDENT
define table function zcds_cdp_slot_count_tf
returns {
  mandt           : mandt;
  slot            : abap.char(20);
  delivery_count  : abap.int4;
  breached_count  : abap.int4;
  atrisk_count    : abap.int4;
  
}
implemented by method zcl_cdp_open_deliv_amdp=>get_slot_counts;
```

**Checklist:**
- [ ] Activates without errors — "method not found" means `get_slot_counts` not yet added to `ZCL_CDP_OPEN_DELIV_AMDP`
- [ ] `slot` field is `abap.char(20)` and matches the table function object
- [ ] Implementor is `zcl_cdp_open_deliv_amdp=>get_slot_counts` (NOT a separate slot count class)

---

## Step 8 — Slot Count Consumption View: ZCDS_CDP_C_SLOT_COUNT

```cds
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
    
```

> **Key design points:**
> - `slot` is the display key (e.g. `10:00 - 11:00`) — a single string field combining slot start and end
> - Three separate criticality fields are needed for per-column colouring:
>   `BreachedCriticality` (red for Breached column), `AtRiskCriticality` (amber for At Risk column),
>   `SlotRiskCriticality` (overall row colour on # Deliveries column)
> - The TF returns a combined `slot` string (`HH:MM - HH:MM`) as `abap.char(20)`

---

## Step 9 — Slot Count DDLX: ZCDS_CDP_C_SLOT_COUNT

```ddlx
@Metadata.layer: #CUSTOMER

@UI.headerInfo: {
  typeName:       'Slot',
  typeNamePlural: 'Slots'
}

annotate view zcds_cdp_c_slot_count with
{
  @UI.lineItem: [{ position: 10, label: 'Slot', importance: #HIGH }]
  Slot;

  @UI.lineItem: [{ position: 20, label: '# Deliveries', importance: #HIGH }]
  DeliveryCount;

  @UI.lineItem: [{ position: 30, label: 'Breached', importance: #HIGH }]
  BreachedCount;

  @UI.lineItem: [{ position: 40, label: 'At Risk', importance: #HIGH }]
  AtRiskCount;

  // Hidden: criticality fields retained in the view for potential future use
  @UI.hidden: true
  BreachedCriticality;

  @UI.hidden: true
  AtRiskCriticality;

  @UI.hidden: true
  SlotRiskCriticality;
}
```

> **Known limitation — column colour coding in OVP table cards (OData V2):**
>
> Both documented approaches for column colour in OVP table cards were attempted and confirmed non-functional:
>
> 1. `criticality: 'FieldPath'` on `@UI.lineItem` DataField records — **silently ignored** in OVP.
>    This is a List Report SmartTable feature, not an OVP table card feature.
>
> 2. `type: #AS_DATAPOINT` + `@UI.dataPoint` with `criticality:` path — causes **empty columns**.
>    OVP renders a DataPoint widget (requiring a numeric aggregation context) instead of a plain value.
>
> Column colour coding in OVP table cards on OData V2 is not achievable through standard
> annotations. The criticality fields (`BreachedCriticality`, `AtRiskCriticality`,
> `SlotRiskCriticality`) remain in the consumption view in case this becomes supported
> in a future UI5 version or when migrating to OData V4 (`sap.ovp.cards.v4.table`).

### ZCDS_CDP_DASHBOARD_CONFIG (Used by Service)

```cds
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
```

---

## Step 10 — Service Definition

```cds
@EndUserText.label: 'Open Deliveries'
define service Zcdp_open_deliv_srv {
  expose zcds_cdp_c_open_deliv     as OpenDeliverySet;
  expose zcds_cdp_store_vh         as StoreValueHelp;
  expose ZCDS_CDP_VSTEL_VH         as ShippingPointHelp;
  expose zcds_cdp_has_slot_vh      as SlotValueHelp;
  expose zcds_cdp_c_slot_count     as SlotCountSet;
  expose zcds_cdp_dashboard_config as DashboardConfigSet;
}
```

> The alias names here become the EntitySet names in OData. They must match exactly
> what is used in `manifest.json` (`entitySet`, `globalFilterEntitySet`) and
> `annotation.xml` (Target namespace).

**Checklist:**
- [ ] Activates without errors
- [ ] All service aliases present

---

## Step 11 — Service Binding

**In ADT:** New → Service Binding → `ZCDP_OPEN_DELIV_BIND`

| Field | Value |
|-------|-------|
| Binding Type | `OData V2 - UI` |
| Service Definition | `ZCDP_OPEN_DELIV_SRV_DEF` |
| Description | `Open Delivery Dashboard` ← **mandatory — blank blocks activation** |

After saving: click **Publish Local**.

**Checklist:**
- [ ] Published without errors
- [ ] `$metadata` loads: `/sap/opu/odata/sap/ZCDP_OPEN_DELIV_SRV/$metadata`
- [ ] `OpenDeliverySet` and `SlotCountSet` both present in `$metadata`
- [ ] `RiskBucket` shows `Type="Edm.String"` in `$metadata`

---

## Step 12 — annotation.xml

**Location:** `webapp/annotations/annotation.xml`

> **The most important rule:** Use the **CDS schema namespace** for the `Target` — NOT the
> OData service namespace. Using the OData namespace silently breaks bucket filtering on
> initial card load — all cards show identical unfiltered data.
>
> | Type | Example | Use |
> |------|---------|-----|
> | CDS namespace ✓ | `cds_zcdp_open_deliv_srv.OpenDeliverySetType` | annotation.xml Target |
> | OData namespace ✗ | `ZCDP_OPEN_DELIV_SRV0001.OpenDeliverySetType` | Do NOT use here |
>
> The CDS namespace is confirmed at runtime from `$metadata` — it is the lower-cased
> service definition name. The EntityType is the EntitySet alias + `Type`.

```xml
<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0"
  xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"
  xmlns="http://docs.oasis-open.org/odata/ns/edm">
  <edmx:DataServices>
    <Schema Namespace="localAnnotations">

      <Annotations Target="cds_zcdp_open_deliv_srv.OpenDeliverySetType">

        <!--
          UI.Identification#deliveryNav — row click navigation.
          identificationAnnotationPath in manifest.json points here.
          doCustomNavigation in MainExtension.controller.js overrides
          the action at runtime based on delivery status.

          CRITICAL: Do NOT add Common.SemanticObject on DeliveryNumber
          in this file or in the DDLX. That renders delivery numbers as
          SmartLink hyperlinks and shows a disambiguation popup instead
          of calling doCustomNavigation.
        -->
        <Annotation Term="com.sap.vocabularies.UI.v1.Identification" Qualifier="deliveryNav">
          <Collection>
            <Record Type="com.sap.vocabularies.UI.v1.DataFieldForIntentBasedNavigation">
              <PropertyValue Property="SemanticObject" String="custdel"/>
              <PropertyValue Property="Action"         String="manage"/>
              <PropertyValue Property="Label"          String="Open Delivery"/>
            </Record>
          </Collection>
        </Annotation>

        <!-- ── Bucket SelectionVariants ──────────────────────────────── -->

        <Annotation Term="com.sap.vocabularies.UI.v1.SelectionVariant" Qualifier="Breached">
          <Record><PropertyValue Property="SelectOptions"><Collection>
            <Record Type="com.sap.vocabularies.UI.v1.SelectOptionType">
              <PropertyValue Property="PropertyName" PropertyPath="RiskBucket"/>
              <PropertyValue Property="Ranges"><Collection>
                <Record Type="com.sap.vocabularies.UI.v1.SelectionRangeType">
                  <PropertyValue Property="Sign"   EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeSignType/I"/>
                  <PropertyValue Property="Option" EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeOptionType/EQ"/>
                  <PropertyValue Property="Low"    String="BREACHED"/>
                </Record>
              </Collection></PropertyValue>
            </Record>
          </Collection></PropertyValue></Record>
        </Annotation>

        <Annotation Term="com.sap.vocabularies.UI.v1.SelectionVariant" Qualifier="AtRisk">
          <Record><PropertyValue Property="SelectOptions"><Collection>
            <Record Type="com.sap.vocabularies.UI.v1.SelectOptionType">
              <PropertyValue Property="PropertyName" PropertyPath="RiskBucket"/>
              <PropertyValue Property="Ranges"><Collection>
                <Record Type="com.sap.vocabularies.UI.v1.SelectionRangeType">
                  <PropertyValue Property="Sign"   EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeSignType/I"/>
                  <PropertyValue Property="Option" EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeOptionType/EQ"/>
                  <PropertyValue Property="Low"    String="ATRISK"/>
                </Record>
              </Collection></PropertyValue>
            </Record>
          </Collection></PropertyValue></Record>
        </Annotation>

        <Annotation Term="com.sap.vocabularies.UI.v1.SelectionVariant" Qualifier="DueNextHour">
          <Record><PropertyValue Property="SelectOptions"><Collection>
            <Record Type="com.sap.vocabularies.UI.v1.SelectOptionType">
              <PropertyValue Property="PropertyName" PropertyPath="RiskBucket"/>
              <PropertyValue Property="Ranges"><Collection>
                <Record Type="com.sap.vocabularies.UI.v1.SelectionRangeType">
                  <PropertyValue Property="Sign"   EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeSignType/I"/>
                  <PropertyValue Property="Option" EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeOptionType/EQ"/>
                  <PropertyValue Property="Low"    String="DUENEXTHOUR"/>
                </Record>
              </Collection></PropertyValue>
            </Record>
          </Collection></PropertyValue></Record>
        </Annotation>

        <Annotation Term="com.sap.vocabularies.UI.v1.SelectionVariant" Qualifier="ToDo">
          <Record><PropertyValue Property="SelectOptions"><Collection>
            <Record Type="com.sap.vocabularies.UI.v1.SelectOptionType">
              <PropertyValue Property="PropertyName" PropertyPath="RiskBucket"/>
              <PropertyValue Property="Ranges"><Collection>
                <Record Type="com.sap.vocabularies.UI.v1.SelectionRangeType">
                  <PropertyValue Property="Sign"   EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeSignType/I"/>
                  <PropertyValue Property="Option" EnumMember="com.sap.vocabularies.UI.v1.SelectionRangeOptionType/EQ"/>
                  <PropertyValue Property="Low"    String="TODO"/>
                </Record>
              </Collection></PropertyValue>
            </Record>
          </Collection></PropertyValue></Record>
        </Annotation>

      </Annotations>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
```

---

## Step 13 — manifest.json

**Five rules that must ALL be satisfied or filters will silently not work:**

| Rule | Setting | Why it matters |
|------|---------|----------------|
| 1 | `"globalFilterModel": "mainModel"` | Must match model key in `sap.ui5.models` exactly |
| 2 | `"globalFilterEntitySet": "OpenDeliverySet"` | EntitySet name — `globalFilterEntityType` is deprecated since SAPUI5 1.54 |
| 3 | `"enableLiveFilter": false` | Shows the Go button — `true` hides it but doesn't auto-refresh |
| 4 | `"model": "mainModel"` on each card | At card level, NOT inside `settings`. OVP only appends `$filter` to cards whose model matches `globalFilterModel` |
| 5 | `annotation.xml` Target | CDS namespace `cds_zcdp_open_deliv_srv.OpenDeliverySetType` — NOT the OData service namespace. Includes `UI.Identification#deliveryNav` for row navigation |

> **Card template rule:**
> - Delivery cards (Breached / At Risk / Due Next Hour / To Do) must use `"sap.ovp.cards.list"` — the list card supports row click navigation via `identificationAnnotationPath`.
> - The slot count card uses `"sap.ovp.cards.table"` — the table card does not support row click navigation and is correct for a summary/aggregation display.

```json
{
  "_version": "1.17.0",
  "sap.app": {
    "id": "coza.dischem.zcdpopendash",
    "type": "application",
    "i18n": "i18n/i18n.properties",
    "applicationVersion": { "version": "0.0.1" },
    "title": "{{appTitle}}",
    "description": "{{appDescription}}",
    "resources": "resources.json",
    "dataSources": {
      "ZCDP_OPEN_DELIV_SRV_VAN": {
        "uri": "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Annotations(TechnicalName='ZCDP_OPEN_DELIV_SRV_VAN',Version='0001')/$value/",
        "type": "ODataAnnotation",
        "settings": { "localUri": "localService/mainService/ZCDP_OPEN_DELIV_SRV_VAN.xml" }
      },
      "annotation": {
        "type": "ODataAnnotation",
        "uri": "annotations/annotation.xml",
        "settings": { "localUri": "annotations/annotation.xml" }
      },
      "mainService": {
        "uri": "/sap/opu/odata/sap/ZCDP_OPEN_DELIV_SRV/",
        "type": "OData",
        "settings": {
          "annotations": [ "ZCDP_OPEN_DELIV_SRV_VAN", "annotation" ],
          "localUri": "localService/mainService/metadata.xml",
          "odataVersion": "2.0"
        }
      }
    }
  },
  "sap.ui5": {
    "flexEnabled": true,
    "dependencies": {
      "minUI5Version": "1.71.77",
      "libs": {
        "sap.m": {}, "sap.ui.core": {}, "sap.ushell": {}, "sap.f": {},
        "sap.ui.comp": {}, "sap.ui.generic.app": {},
        "sap.suite.ui.generic.template": {}, "sap.ovp": {},
        "sap.ui.rta": {}, "sap.ui.layout": {}
      }
    },
    "contentDensities": { "compact": true, "cozy": true },
    "models": {
      "i18n": {
        "type": "sap.ui.model.resource.ResourceModel",
        "settings": { "bundleName": "coza.dischem.zcdpopendash.i18n.i18n" }
      },
      "mainModel": {
        "dataSource": "mainService",
        "preload": true,
        "settings": {
          "defaultBindingMode": "TwoWay",
          "defaultCountMode": "Inline",
          "refreshAfterChange": false,
          "metadataUrlParams": { "sap-value-list": "none" }
        }
      },
      "@i18n": {
        "type": "sap.ui.model.resource.ResourceModel",
        "uri": "i18n/i18n.properties"
      }
    },
    "extends": {
      "extensions": {
        "sap.ui.controllerExtensions": {
          "sap.ovp.app.Main": {
            "controllerName": "coza.dischem.zcdpopendash.ext.controller.MainExtension"
          }
        }
      }
    }
  },
  "sap.ovp": {
    "globalFilterModel": "mainModel",
    "globalFilterEntitySet": "OpenDeliverySet",
    "containerLayout": "resizable",
    "enableLiveFilter": false,
    "considerAnalyticalParameters": false,
    "cards": {
      "cardBreached": {
        "model": "mainModel",
        "template": "sap.ovp.cards.list",
        "settings": {
          "title": "Breached",
          "subTitle": "Action required now",
          "entitySet": "OpenDeliverySet",
          "sortBy": "DelWindowStart",
          "sortOrder": "ascending",
          "selectionAnnotationPath":      "com.sap.vocabularies.UI.v1.SelectionVariant#Breached",
          "annotationPath":               "com.sap.vocabularies.UI.v1.LineItem#Breached",
          "identificationAnnotationPath": "com.sap.vocabularies.UI.v1.Identification#deliveryNav",
          "defaultSpan": { "rows": 3, "cols": 1 }
        }
      },
      "cardAtRisk": {
        "model": "mainModel",
        "template": "sap.ovp.cards.list",
        "settings": {
          "title": "At Risk",
          "entitySet": "OpenDeliverySet",
          "sortBy": "DelWindowStart",
          "sortOrder": "ascending",
          "selectionAnnotationPath":      "com.sap.vocabularies.UI.v1.SelectionVariant#AtRisk",
          "annotationPath":               "com.sap.vocabularies.UI.v1.LineItem#AtRisk",
          "identificationAnnotationPath": "com.sap.vocabularies.UI.v1.Identification#deliveryNav",
          "defaultSpan": { "rows": 3, "cols": 1 }
        }
      },
      "cardDueNextHour": {
        "model": "mainModel",
        "template": "sap.ovp.cards.list",
        "settings": {
          "title": "Due Next Hour",
          "entitySet": "OpenDeliverySet",
          "sortBy": "DelWindowStart",
          "sortOrder": "ascending",
          "selectionAnnotationPath":      "com.sap.vocabularies.UI.v1.SelectionVariant#DueNextHour",
          "annotationPath":               "com.sap.vocabularies.UI.v1.LineItem#DueNextHour",
          "identificationAnnotationPath": "com.sap.vocabularies.UI.v1.Identification#deliveryNav",
          "defaultSpan": { "rows": 3, "cols": 1 }
        }
      },
      "cardToDo": {
        "model": "mainModel",
        "template": "sap.ovp.cards.list",
        "settings": {
          "title": "To Do",
          "entitySet": "OpenDeliverySet",
          "sortBy": "Wadat",
          "sortOrder": "ascending",
          "selectionAnnotationPath":      "com.sap.vocabularies.UI.v1.SelectionVariant#ToDo",
          "annotationPath":               "com.sap.vocabularies.UI.v1.LineItem#ToDo",
          "identificationAnnotationPath": "com.sap.vocabularies.UI.v1.Identification#deliveryNav",
          "defaultSpan": { "rows": 3, "cols": 1 }
        }
      },
      "cardSlotCount": {
        "model": "mainModel",
        "template": "sap.ovp.cards.table",
        "settings": {
          "title": "Today Slot Order Count",
          "entitySet": "SlotCountSet",
          "sortBy": "SlotSortKey",
          "sortOrder": "ascending",
          "annotationPath": "com.sap.vocabularies.UI.v1.LineItem",
          "defaultSpan": { "rows": 5, "cols": 2 }
        }
      }
    }
  },
  "sap.fiori": {
    "registrationIds": [],
    "archeType": "analytical"
  }
}
```

**Checklist:**
- [ ] `globalFilterModel: "mainModel"` matches the key in `sap.ui5.models`
- [ ] `globalFilterEntitySet: "OpenDeliverySet"` — no `globalFilterEntityType`
- [ ] `"model": "mainModel"` on every card at card level (NOT inside `settings`)
- [ ] `enableLiveFilter: false`
- [ ] `identificationAnnotationPath: "...Identification#deliveryNav"` on all four delivery cards
- [ ] `cardSlotCount` uses `"entitySet": "SlotCountSet"`
- [ ] `extends.extensions.sap.ui.controllerExtensions` wired to `MainExtension`

---

## Step 14 — Controller Extension: MainExtension.controller.js

**Location:** `webapp/ext/controller/MainExtension.controller.js`

Create the `ext/controller/` folders if they don't exist.

This extension uses `modifyStartupExtension` — the OVP lifecycle hook that fires after
`oGlobalFilter` is fully initialised. All earlier hooks (`onInit`, `onAfterRendering`)
fire before `oGlobalFilter` is set.

```javascript
sap.ui.define([], function () {
    "use strict";

    return {

        /**
         * modifyStartupExtension fires after OVP has fully initialised
         * including oGlobalFilter. This is the correct hook to expand
         * the SmartFilterBar on page load.
         *
         * Must return oCustomSelectionVariant unchanged.
         */
        modifyStartupExtension: function (oCustomSelectionVariant) {
            const oSFB = this.oGlobalFilter;
            if (oSFB && typeof oSFB.setFilterBarExpanded === "function") {
                oSFB.setFilterBarExpanded(true);
            }
            return oCustomSelectionVariant;
        },

        /*------------------------------------------------------------------
          doCustomNavigation — FDS Section 4 status-based routing.

          Called by OVP for BOTH header clicks and row clicks.
          Returns a navigation entry object to override the default,
          or returns nothing (undefined) to use the annotation default.

          CONFIRMED PRODUCTION RULES:
          1. Use oContext.sPath not oContext.getPath()
          2. Guard with typeof oContext.getProperty — header clicks pass
             a context that exists but has no getProperty method
          3. Return undefined (not oNavigationEntry) for non-custom cases
          4. url: "" and label: "" are required even for intent navigation
          5. Common.SemanticObject must NOT be on DeliveryNumber in
             annotation.xml or DDLX — causes SmartLink disambiguation popup
        ------------------------------------------------------------------*/
        doCustomNavigation: function (sCardId, oContext, oNavigationEntry) {

            const aDeliveryCards = [
                "cardBreached", "cardAtRisk", "cardDueNextHour", "cardToDo"
            ];
            if (aDeliveryCards.indexOf(sCardId) === -1) {
                return;
            }

            // Guard: header clicks pass context without getProperty
            if (!oContext ||
                !oContext.sPath ||
                typeof oContext.getProperty !== "function") {
                return;
            }

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

    // Priority 1: Management — locked, approval pending, or awaiting IBT
    // Priority 2: Packing   — pick finalised or packing started
    // Priority 3: Picking   — everything else (default)
    function _resolveAction(oEntity) {
        if (oEntity.Locked            === "X" ||
            oEntity.RandomMngApproval === "X" ||
            oEntity.AwaitingIbt       === "X") { return "manage"; }
        if (oEntity.PickFinalized  === "X" ||
            oEntity.PackingStarted === "X") { return "packing"; }
        return "picking";
    }

});
```

> **Why not `onInit` or `onAfterRendering`:**
> OVP sets `this.oGlobalFilter` during its own `onInit`. The controller extension
> methods are mixed into `sap.ovp.app.Main` and called in the same lifecycle —
> `onInit` on the extension fires **before** OVP's own `onInit` completes, so
> `oGlobalFilter` is always `undefined`. `modifyStartupExtension` is an OVP-specific
> hook that fires after app startup is complete and `oGlobalFilter` is populated.

**Checklist:**
- [ ] File is at `webapp/ext/controller/MainExtension.controller.js`
- [ ] `manifest.json` `sap.ui5.extends.extensions.sap.ui.controllerExtensions` points to this file
- [ ] Filter bar is expanded on page load

---

## Final Verification

```
BACKEND
□ All ABAP objects activate without errors
□ $metadata loads:
    /sap/opu/odata/sap/ZCDP_OPEN_DELIV_SRV/$metadata
□ RiskBucket shows Type="Edm.String" in $metadata
□ OpenDeliverySet and SlotCountSet EntitySets both present

DIRECT ODATA TESTS (paste in browser)
□ Bucket filter:
    /OpenDeliverySet?$filter=RiskBucket eq 'BREACHED'&$top=5
  → Returns BREACHED rows only

□ Combined bucket + store:
    /OpenDeliverySet?$filter=RiskBucket eq 'BREACHED' and Store eq 'A001'&$top=5
  → Returns BREACHED rows for that store only

□ Slot count today:
    /SlotCountSet?$top=20
  → Returns one row per slot start time with delivery_count, breached_count, atrisk_count

FIORI APP
□ Filter bar is expanded on page open (not collapsed)
□ All four bucket cards show data on initial load
□ Card 5 (Today Slot Order Count) shows slot rows with counts
□ Site dropdown shows store names (not blank)
□ Shipping Point dropdown shows descriptions (not blank)
□ Select a store → press Go → Network tab shows new OData requests
    with $filter containing Store eq '...' AND RiskBucket eq '...'
□ Card counts change after pressing Go
□ Click a delivery row → navigates directly to correct app (no disambiguation popup)
    Locked / Approval / IBT  → custdel-manage
    PickFinalized / Packing  → custdel-packing
    Everything else          → custdel-picking
```

---

## Pitfalls Reference

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| All cards show same rows on initial load | `annotation.xml` Target namespace wrong — silently ignored | Use CDS namespace: `cds_zcdp_open_deliv_srv.OpenDeliverySetType` — NOT the OData service namespace |
| Cards load data but Go fires no OData requests | `"model": "mainModel"` missing from card definitions | Add at card level (sibling of `"template"`), NOT inside `"settings"` |
| Go button fires nothing | `globalFilterEntityType` used — deprecated since SAPUI5 1.54 | Replace with `"globalFilterEntitySet": "OpenDeliverySet"` |
| Go button not visible | `enableLiveFilter: true` | Set to `false` |
| Filter bar collapsed on load | `modifyStartupExtension` not implemented or `oGlobalFilter` undefined | Use `modifyStartupExtension` hook — not `onInit` or `onAfterRendering` |
| `setFilterBarExpanded is not a function` | `onInit` extension fires before `oGlobalFilter` is set — `this.oGlobalFilter` is undefined | Move to `modifyStartupExtension` which fires after OVP init completes |
| AMDP: "MAKE_TIMESTAMP unknown" | Not available on this HANA/ABAP version | Use `ADD_SECONDS( TO_DATE(wadat), secs )` |
| AMDP: SQL 2048 format string error | `DEL_WINDOW_START` arrives as `'HH:MM'` with colon | Use `RPAD( REPLACE( del_window_start, ':', '' ), 6, '0' )` |
| AMDP: sqladd / longdate error | `TO_VARCHAR(wadat,'YYYYMMDD')` on DATS triggers HANA longdate path | Use `ADD_SECONDS( TO_DATE(wadat), secs )` |
| "Local names must start with `:` " | CTE reference missing colon in `BY DATABASE FUNCTION` | Use `FROM :lt_xxx` — colon is required for all tabvar references |
| CDS TF: "method not found" on `ZCDS_CDP_SLOT_COUNT_TF` | `get_slot_counts` method not yet added to `ZCL_CDP_OPEN_DELIV_AMDP` | Add `CLASS-METHODS get_slot_counts FOR TABLE FUNCTION zcds_cdp_slot_count_tf` to the class and activate it first |
| DDLX: "Element must have at least one annotation" | Bare field entry in `annotate view` block | Remove bare entries or add a minimal annotation like `@EndUserText.label` |
| VH popup loses value help | DDLX has `@UI.selectionField` on `Store`/`Vstel` without VH definition | Remove `@UI.selectionField` from DDLX for VH fields — keep only in DDL |
| Dropdown shows blank tokens | `@UI.textArrangement: #TEXT_ONLY` missing on VH view key field | Add alongside `@ObjectModel.text.element` |
| Blank tokens despite annotations | `@Metadata.ignorePropagatedAnnotations: true` on VH view | Remove this annotation from all VH views |
| `@ObjectModel.resultSet.sizeCategory: #S` error | `#S` is not a valid value | Use `#XS` — the only valid value |
| VH dialog shows Go button | `@ObjectModel.resultSet.sizeCategory: #XS` missing from VH header | Add as standalone header annotation outside `usageType` block |
| Service binding blocked | Description field empty | Enter any description text |
| Card 5 shows no data | `SlotCountSet` missing from service definition, or `get_slot_counts` method not added to `ZCL_CDP_OPEN_DELIV_AMDP` | Add `expose zcds_cdp_c_slot_count as SlotCountSet` to service definition. Add `CLASS-METHODS get_slot_counts FOR TABLE FUNCTION zcds_cdp_slot_count_tf` to the existing `ZCL_CDP_OPEN_DELIV_AMDP` class and activate |
| `XML_CONVERSION_TIME` / `CX_SY_CONVERSION_NO_DATE_TIME` on SlotCountSet | Slot values are typed with a time/domain type that serializes as `Edm.Time` instead of a plain string | Use a character field for slot display in `ZCDS_CDP_SLOT_COUNT_TF` (current object uses `slot : abap.char(20)`). Re-activate TF → consumption view → re-publish binding |
| Slot count card columns show no colour | Column-level colour coding in OVP table cards on OData V2 is **not supported** via standard annotations. Neither `criticality:` on DataField (silently ignored) nor `type: #AS_DATAPOINT` (causes empty columns) works. The criticality CASE fields remain in the view for future use when migrating to OData V4 | No fix available on OData V2. Migrate card to `sap.ovp.cards.v4.table` for full `DataPoint` criticality support |
| Delivery rows are not clickable / no navigation on row click | Card template is `sap.ovp.cards.table`. The table card does not support row-level click navigation — `identificationAnnotationPath` is ignored | Change the four delivery cards to `"template": "sap.ovp.cards.list"`. Keep `sap.ovp.cards.table` only for the slot count summary card |
| Navigation buttons not appearing on row click | `identificationAnnotationPath` missing from card settings, or pointing to wrong qualifier | Add `"identificationAnnotationPath": "com.sap.vocabularies.UI.v1.Identification#deliveryNav"` to each delivery card's `settings` |
| `e.getProperty is not a function` in doCustomNavigation | Header click passes an `oContext` that exists but has no `getProperty` method — checking only `!oContext` is insufficient | Guard with `typeof oContext.getProperty !== "function"` before calling `oContext.getProperty(oContext.sPath)` |
| Disambiguation popup appears on delivery row click | `Common.SemanticObject` set on `DeliveryNumber` in annotation.xml or generated by `semanticObjectAction` in DDLX — SmartLink intercepts click before `doCustomNavigation` fires | Remove `Common.SemanticObject` from annotation.xml for `DeliveryNumber`. Remove `@UI.identification` with `semanticObjectAction` from the DDLX entirely |
| Navigation fires but app does not open | Semantic Object `custdel` not registered in Fiori Launchpad | Register target mappings in SPRO: `custdel-manage`, `custdel-picking`, `custdel-packing` |
| Card header shows a large KPI number instead of data | `dataPointAnnotationPath` set on a list/table card — this renders the DataPoint `Value` field as an aggregated KPI number in the card header body, not as a colour | Remove `dataPointAnnotationPath` from list/table card settings. This property is intended for analytical/chart cards. Card header background colour based on data criticality is not supported on OVP list/table cards via standard OData V2 annotations |

