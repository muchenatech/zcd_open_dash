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