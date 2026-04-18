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
    USING likp lips vbak t001w  tvakt zconstants
          zcdp_shippt zcdp_ordtypes zcdp_ddellock.

    DECLARE lv_breach_mins INTEGER DEFAULT 17;
    DECLARE lv_risk_mins   INTEGER DEFAULT 20;
    DECLARE lv_atrisk_mins INTEGER DEFAULT 37;

    SELECT
        COALESCE(
          MAX( CASE WHEN field_value = 'BREACH'
                     AND description LIKE_REGEXPR '^[0-9]+$'
                    THEN TO_INTEGER( description )
               END ),
          17 ),
        COALESCE(
          MAX( CASE WHEN field_value = 'RISK'
                     AND description LIKE_REGEXPR '^[0-9]+$'
                    THEN TO_INTEGER( description )
               END ),
          20 )
      INTO lv_breach_mins, lv_risk_mins
      FROM zconstants
     WHERE const_type = 'DASHBOARD'
       AND field_name = 'LEADTIMES';

    lv_atrisk_mins = :lv_breach_mins + :lv_risk_mins;

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
        SESSION_CONTEXT('TIMEZONE')                       AS store_tzone,
        vbak.ihrez,
        lips.werks,
        t1.name1                                          AS werks_name,
        vbak.vbeln                                        AS vbeln_au,
        vbak.auart,
        vbak.kunnr,
        tvakt.bezei                                       AS auart_text,

        /* Stale lock suppression: 30-minute TTL */
        CASE
          WHEN lck.uname IS NOT NULL
*           AND SECONDS_BETWEEN( lck.timestamp,
*                                CURRENT_UTCTIMESTAMP ) <= 1800
          THEN lck.uname ELSE NULL
        END                                               AS lock_user,
        lck.timestamp                                     AS lock_timestamp,

        CASE
          WHEN lck.uname IS NOT NULL
*           AND SECONDS_BETWEEN( lck.timestamp,
*                                CURRENT_UTCTIMESTAMP ) <= 1800
          THEN 'X' ELSE ''
        END                                               AS locked,

        CASE likp.lifsk WHEN 'OH' THEN 'X' ELSE '' END    AS on_hold,
        CASE likp.lifsk WHEN 'ZR' THEN 'X' ELSE '' END    AS random_mng_approval,
        CASE likp.lifsk WHEN 'ZE' THEN 'X' ELSE '' END    AS refunds_mng_approval,
        CASE likp.kostk WHEN 'B'  THEN 'X' ELSE '' END    AS picking_started,
        CASE WHEN likp.pkstk IN ('B','D') THEN 'X' ELSE '' END AS packing_started,
        CASE likp.pkstk WHEN 'C'  THEN 'X' ELSE '' END    AS fully_packed,
        CASE likp.kostk WHEN 'C'  THEN 'X' ELSE '' END    AS fully_picked,
        CASE likp.wbstk WHEN 'C'  THEN 'X' ELSE '' END    AS fully_issued,
        CASE likp.lifsk WHEN 'Z0' THEN 'X' ELSE '' END    AS pick_finalized,
        CASE likp.lifsk WHEN 'Z1' THEN 'X' ELSE '' END    AS finalized,
        CASE likp.lifsk WHEN 'Z2' THEN 'X' ELSE '' END    AS awaiting_ibt,

        vbak.del_window_start,
        vbak.del_window_end,

        /* Normalised HHMMSS string for parsing */
        RPAD( REPLACE( vbak.del_window_start, ':', '' ), 6, '0' ) AS dws_norm,

        /* has_slot flag — centralises the emptiness check */
*        CASE
*          WHEN RPAD( REPLACE( vbak.del_window_start, ':', '' ), 6, '0' )
*            NOT IN ( '000000', '' )
*           AND vbak.del_window_start IS NOT NULL
*          THEN 'X' ELSE ''
*        END                                               AS has_slot

        CASE
          WHEN
               COALESCE(RPAD(REPLACE(TRIM(vbak.del_window_start), ':', ''), 6, '0'), '000000') = '000000'
           AND COALESCE(RPAD(REPLACE(TRIM(vbak.del_window_end),   ':', ''), 6, '0'), '000000') = '000000'
          THEN ''
          ELSE 'X'
        END AS has_slot

      FROM likp

      INNER JOIN zcdp_shippt AS sp
        ON  sp.vstel = likp.vstel

      INNER JOIN lips
        ON  lips.vbeln  = likp.vbeln
        AND lips.pstyv <> 'YTAX'

      INNER JOIN vbak
        ON  vbak.vbeln  = lips.vgbel

      INNER JOIN zcdp_ordtypes
        ON  zcdp_ordtypes.auart = vbak.auart

      LEFT OUTER JOIN t001w AS t1
        ON  t1.werks = lips.werks

      LEFT OUTER JOIN tvakt
        ON  tvakt.auart = vbak.auart
        AND tvakt.spras = COALESCE( SESSION_CONTEXT( 'LOCALE_SAP' ), 'E' )

      LEFT OUTER JOIN zcdp_ddellock AS lck
        ON  lck.vbeln = likp.vbeln

     WHERE likp.wadat   >= ADD_DAYS( CURRENT_DATE, -200 )
       AND lips.wbsta    <> 'C'
       AND lips.vgtyp     = 'C'
       AND likp.lifsk    <> 'Z1'       /* already packed finalised */
       AND likp.pkstk    <> 'C'       /* already fully packed */
       GROUP BY likp.mandt,                                                -- mirrors zcds_delivery GROUP BY
        likp.vbeln, likp.vstel, likp.wadat, likp.erdat,
        likp.erzet, likp.bolnr,
        likp.kostk, likp.wbstk, likp.pkstk, likp.lifsk, likp.lifex,
        vbak.ihrez, lips.werks, t1.name1, vbak.vbeln, vbak.auart,
        vbak.kunnr, tvakt.bezei, lck.uname, lck.timestamp,
        vbak.del_window_start, vbak.del_window_end;

     lt_slot_state =
      SELECT
        vbeln,
        CASE
          WHEN
            /* DEL_WINDOW_START is initial */
            (
              del_window_start IS NULL
              OR LENGTH(
                   REPLACE(
                     REPLACE(
                       REPLACE(
                         REPLACE(TRIM(del_window_start), ':', ''),
                       ' ', ''),
                     '.', ''),
                   '-', '')
                 ) = 0
              OR REPLACE(
                   REPLACE(
                     REPLACE(
                       REPLACE(TRIM(del_window_start), ':', ''),
                     ' ', ''),
                   '.', ''),
                 '-', '') IN ('0', '00', '000', '0000', '00000', '000000')
            )
            AND
            /* DEL_WINDOW_END is initial */
            (
              del_window_end IS NULL
              OR LENGTH(
                   REPLACE(
                     REPLACE(
                       REPLACE(
                         REPLACE(TRIM(del_window_end), ':', ''),
                       ' ', ''),
                     '.', ''),
                   '-', '')
                 ) = 0
              OR REPLACE(
                   REPLACE(
                     REPLACE(
                       REPLACE(TRIM(del_window_end), ':', ''),
                     ' ', ''),
                   '.', ''),
                 '-', '') IN ('0', '00', '000', '0000', '00000', '000000')
            )
          THEN ''
          ELSE 'X'
        END AS has_slot
      FROM :lt_base;

    lt_tz = SELECT *,
        COALESCE( store_tzone, 'UTC' ) AS effective_tzone,

        /* now in store local time */
        TO_DATE( UTCTOLOCAL( CURRENT_UTCTIMESTAMP,
                             COALESCE( store_tzone, 'UTC' ) ) )
          AS today_local,
        UTCTOLOCAL( CURRENT_UTCTIMESTAMP,
                    COALESCE( store_tzone, 'UTC' ) )
          AS now_local,

        /* slot_ts in store-local time — WADAT is intrinsically local */
        CASE WHEN has_slot = 'X'
          THEN ADD_SECONDS(
                 TO_DATE( wadat ),
                 TO_INTEGER( SUBSTRING( dws_norm, 1, 2 ) ) * 3600
               + TO_INTEGER( SUBSTRING( dws_norm, 3, 2 ) ) * 60 )
          ELSE NULL
        END                                        AS slot_ts_local,

        /* erdat_ts in store-local time */
        ADD_SECONDS(
          TO_DATE( erdat ),
          TO_INTEGER( SUBSTRING( RPAD( REPLACE( erzet, ':', '' ), 6, '0' ), 1, 2 ) ) * 3600
        + TO_INTEGER( SUBSTRING( RPAD( REPLACE( erzet, ':', '' ), 6, '0' ), 3, 2 ) ) * 60
        + TO_INTEGER( SUBSTRING( RPAD( REPLACE( erzet, ':', '' ), 6, '0' ), 5, 2 ) ) )
          AS erdat_ts_local
      FROM :lt_base;

   lt_normalised = SELECT
        mandt,
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

        /* Display fields */
        SUBSTRING( TO_NVARCHAR( wadat ), 7, 2 ) || '.' ||
        SUBSTRING( TO_NVARCHAR( wadat ), 5, 2 ) || '.' ||
        SUBSTRING( TO_NVARCHAR( wadat ), 1, 4 )
          AS wadat_display,

        /* "Today" substitution for Breached card per FDS */
        CASE WHEN wadat = today_local THEN 'Today'
             ELSE SUBSTRING( TO_NVARCHAR( wadat ), 7, 2 ) || '.' ||
                  SUBSTRING( TO_NVARCHAR( wadat ), 5, 2 ) || '.' ||
                  SUBSTRING( TO_NVARCHAR( wadat ), 1, 4 )
        END AS wadat_display_today,

        del_window_start,
        del_window_end,

        CASE
          WHEN has_slot = 'X'
          THEN del_window_start || ' - ' || del_window_end
          ELSE 'No Slot'
        END AS slot_display,

        /* Uniform status code (0–A) + status text */
        CASE
          WHEN lifsk = 'OH'                            THEN '8'
          WHEN lifsk = 'ZR'                            THEN '9'
          WHEN lifsk = 'ZE'                            THEN 'A'
          WHEN wbstk = 'C'                             THEN '6'
          WHEN lock_user IS NOT NULL                   THEN '1'
          WHEN lifsk = 'Z1'                            THEN '5'
          WHEN lifsk = 'Z2'                            THEN '7'
          WHEN pkstk IN ('B','D')                      THEN '4'
          WHEN lifsk = 'Z0'                            THEN '3'
          WHEN kostk = 'B'                             THEN '2'
          ELSE                                              '0'
        END                                           AS status,

        CASE
          WHEN lifsk = 'OH'                            THEN 'On Hold'
          WHEN lifsk = 'ZR'                            THEN 'Random Mng Approval'
          WHEN lifsk = 'ZE'                            THEN 'Refunds Mng Approval'
          WHEN wbstk = 'C'                             THEN 'Fully Issued'
          WHEN lock_user IS NOT NULL                   THEN 'Picking Locked by User ' || lock_user
          WHEN lifsk = 'Z1'                            THEN 'Finalised'
          WHEN lifsk = 'Z2'                            THEN 'Awaiting IBT'
          WHEN pkstk IN ('B','D')                      THEN 'Packing Started'
          WHEN lifsk = 'Z0'                            THEN 'Pick Finalised'
          WHEN kostk = 'B'                             THEN 'Picking Started'
          ELSE                                              'Awaiting Picking'
        END                                           AS status_text,

        lifsk, pkstk, kostk, wbstk,
        locked, lock_user, lock_timestamp,
        on_hold, picking_started, fully_picked, packing_started,
        fully_packed, fully_issued, pick_finalized, finalized,
        awaiting_ibt, random_mng_approval, refunds_mng_approval,
        has_slot,

        CASE WHEN slot_ts_local IS NOT NULL
             THEN CAST( SECONDS_BETWEEN( now_local, slot_ts_local ) / 60 AS INTEGER )
             ELSE NULL
        END                                           AS minutes_to_slot,

        /* --------------------------------------------------------
           Risk bucket — priority-ordered CASE.
           FDS §B.1 bucket rules + ZOLC special case from Round 5.
        -------------------------------------------------------- */
        CASE
          /* Priority 1: management holds */
          WHEN lifsk IN ('OH','ZR','ZE')
            THEN 'TODO'

          /* Priority 2: no slot + ZOLC collection order */
          WHEN has_slot <> 'X' AND vstel = 'ZOLC' AND erdat < today_local
            THEN 'BREACHED'
          WHEN has_slot <> 'X' AND vstel = 'ZOLC' AND erdat = today_local
                                 AND SECONDS_BETWEEN( erdat_ts_local, now_local ) > 7200  /* strict > */
            THEN 'BREACHED'
          WHEN has_slot <> 'X' AND vstel = 'ZOLC'
            THEN 'ATRISK'

          /* Priority 3: no slot + other shipping points */
          WHEN has_slot <> 'X' AND wadat < ADD_DAYS( today_local, -2 )
            THEN 'BREACHED'
          WHEN has_slot <> 'X'
            THEN 'TODO'

          /* Priority 4: has slot, wadat past */
          WHEN has_slot = 'X' AND wadat < today_local
            THEN 'BREACHED'

          /* Priority 5: has slot, wadat future */
          WHEN has_slot = 'X' AND wadat > today_local
            THEN 'TODO'

          /* Priority 6–7: has slot, today — minute thresholds */
          WHEN has_slot = 'X'
           AND SECONDS_BETWEEN( now_local, slot_ts_local ) / 60 <= :lv_breach_mins
            THEN 'BREACHED'
          WHEN has_slot = 'X'
           AND SECONDS_BETWEEN( now_local, slot_ts_local ) / 60 <= :lv_atrisk_mins
            THEN 'ATRISK'

          /* Priority 8: Due Next Hour — clock-hour rule with slot minute = 00 */
          WHEN has_slot = 'X'
           AND SUBSTRING( dws_norm, 3, 2 ) = '00'
           AND TO_INTEGER( SUBSTRING( dws_norm, 1, 2 ) ) = HOUR( ADD_SECONDS( now_local, 3600 ) )
            THEN 'DUENEXTHOUR'

          ELSE 'TODO'
        END                                           AS risk_bucket,

        /* Criticality: 1=Red 2=Orange 3=Yellow 5=Green */
        CASE
          WHEN lifsk IN ('OH','ZR','ZE')
            THEN 5
          WHEN has_slot <> 'X' AND vstel = 'ZOLC' AND
               ( erdat < today_local
              OR ( erdat = today_local
                   AND SECONDS_BETWEEN( erdat_ts_local, now_local ) > 7200 ) )
            THEN 1
          WHEN has_slot <> 'X' AND vstel = 'ZOLC'
            THEN 2
          WHEN slot_ts_local IS NULL
            THEN CASE WHEN wadat < ADD_DAYS( today_local, -2 ) THEN 1 ELSE 5 END
          WHEN wadat < today_local
            THEN 1
          WHEN wadat > today_local
            THEN 5
          WHEN SECONDS_BETWEEN( now_local, slot_ts_local ) / 60 <= :lv_breach_mins  THEN 1
          WHEN SECONDS_BETWEEN( now_local, slot_ts_local ) / 60 <= :lv_atrisk_mins  THEN 2
          WHEN SUBSTRING( dws_norm, 3, 2 ) = '00'
           AND TO_INTEGER( SUBSTRING( dws_norm, 1, 2 ) ) = HOUR( ADD_SECONDS( now_local, 3600 ) )
            THEN 3
          ELSE 5
        END                                           AS risk_criticality

      FROM :lt_tz;

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


          has_slot,
      minutes_to_slot,

        risk_bucket,
       risk_criticality
          FROM :lt_normalised;
         --where has_slot  = 'X';


  ENDMETHOD.

  METHOD get_slot_counts BY DATABASE FUNCTION FOR HDB
    LANGUAGE SQLSCRIPT
    OPTIONS READ-ONLY
    USING likp lips vbak zconstants zcdp_shippt zcdp_ordtypes t001w.

    DECLARE lv_breach_mins INTEGER DEFAULT 17;
    DECLARE lv_risk_mins   INTEGER DEFAULT 20;
    DECLARE lv_atrisk_mins INTEGER DEFAULT 37;

    SELECT
        COALESCE( MAX( CASE WHEN field_value = 'BREACH'
                             AND description LIKE_REGEXPR '^[0-9]+$'
                            THEN TO_INTEGER( description ) END ), 17 ),
        COALESCE( MAX( CASE WHEN field_value = 'RISK'
                             AND description LIKE_REGEXPR '^[0-9]+$'
                            THEN TO_INTEGER( description ) END ), 20 )
      INTO lv_breach_mins, lv_risk_mins
      FROM zconstants
     WHERE const_type = 'DASHBOARD'
       AND field_name = 'LEADTIMES';

    lv_atrisk_mins = :lv_breach_mins + :lv_risk_mins;

    /*--------------------------------------------------------------
      Deliveries for today with slots, by site, excluding holds
      and already-finalised. Timezone-aware today_local.
    --------------------------------------------------------------*/
    lt_today = SELECT
        likp.mandt,
        lips.werks,
        likp.vstel,
        likp.vbeln,
        likp.lifsk,
        likp.wadat,
        vbak.del_window_start,
        vbak.del_window_end,
        RPAD( REPLACE( vbak.del_window_start, ':', '' ), 6, '0' ) AS dws_norm,
        SESSION_CONTEXT('TIMEZONE')                                                   AS store_tzone,
        TO_DATE( UTCTOLOCAL( CURRENT_UTCTIMESTAMP,
                 SESSION_CONTEXT('TIMEZONE') ) )                   AS today_local,
        UTCTOLOCAL( CURRENT_UTCTIMESTAMP,
                    COALESCE( SESSION_CONTEXT('TIMEZONE'), 'UTC' ) )                  AS now_local,
        ADD_SECONDS(
          TO_DATE( likp.wadat ),
          TO_INTEGER( SUBSTRING( RPAD( REPLACE( vbak.del_window_start, ':', '' ), 6, '0' ), 1, 2 ) ) * 3600
        + TO_INTEGER( SUBSTRING( RPAD( REPLACE( vbak.del_window_start, ':', '' ), 6, '0' ), 3, 2 ) ) * 60 )
                                                                    AS slot_ts_local
      FROM likp
      INNER JOIN zcdp_shippt           ON zcdp_shippt.vstel = likp.vstel
      INNER JOIN lips                  ON lips.vbeln = likp.vbeln
                                      AND lips.pstyv <> 'YTAX'
      INNER JOIN vbak                  ON vbak.vbeln = lips.vgbel
      INNER JOIN zcdp_ordtypes         ON zcdp_ordtypes.auart = vbak.auart
      LEFT OUTER JOIN t001w AS t1      ON t1.werks = lips.werks
      WHERE likp.wadat  = TO_DATE( UTCTOLOCAL( CURRENT_UTCTIMESTAMP,
                                               COALESCE( SESSION_CONTEXT('TIMEZONE'), 'UTC' ) ) )
        AND likp.pkstk <> 'C'
        AND likp.lifsk NOT IN ('Z1','OH','ZR','ZE')
        AND RPAD( REPLACE( vbak.del_window_start, ':', '' ), 6, '0' )
              NOT IN ( '000000', '' )
      GROUP BY
        likp.mandt, lips.werks, likp.vstel, likp.vbeln,
        likp.lifsk, likp.wadat,
        vbak.del_window_start, vbak.del_window_end;

    /*-- Per-delivery bucket (aligned with main method) --*/
    lt_bucketed = SELECT
        mandt, werks, vstel,
        del_window_start, del_window_end, dws_norm,
        del_window_start || ' - ' || del_window_end AS slot,
        dws_norm                                    AS slot_sort_key,
        CASE
          WHEN wadat < today_local
            THEN 'BREACHED'
          WHEN SECONDS_BETWEEN( now_local, slot_ts_local ) / 60 <= :lv_breach_mins
            THEN 'BREACHED'
          WHEN SECONDS_BETWEEN( now_local, slot_ts_local ) / 60 <= :lv_atrisk_mins
            THEN 'ATRISK'
          WHEN SUBSTRING( dws_norm, 3, 2 ) = '00'
           AND TO_INTEGER( SUBSTRING( dws_norm, 1, 2 ) ) = HOUR( ADD_SECONDS( now_local, 3600 ) )
            THEN 'DUENEXTHOUR'
          ELSE 'TODO'
        END AS risk_bucket
      FROM :lt_today;

    /*-- Aggregate by slot and site --*/
    RETURN
      SELECT
        mandt,
       -- werks,
        slot,
        slot_sort_key,
        COUNT( * )                                                   AS delivery_count,
        SUM( CASE WHEN risk_bucket = 'BREACHED' THEN 1 ELSE 0 END )  AS breached_count,
        SUM( CASE WHEN risk_bucket = 'ATRISK'   THEN 1 ELSE 0 END )  AS atrisk_count
      FROM :lt_bucketed
      GROUP BY mandt, slot, slot_sort_key
      ORDER BY slot_sort_key;

  ENDMETHOD.

ENDCLASS.