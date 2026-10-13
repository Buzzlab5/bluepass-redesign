# WhatsApp templates for the booking CMS

Generated from `lib/services/rails/whatsapp-templates.ts`; do not edit by hand.

Create each one in Meta Business Manager, WhatsApp Manager, Message templates:

- Category: **Utility**. Every message is about a booking the person made.
- Language: **English** (`en`).
- Variable type: **Name** (named variables, as written below).
- Once all six are approved, set `WHATSAPP_RAILS_ENABLED=true`.

Guest messages are sent from Kai's number (`WHATSAPP_PHONE_ID_KAI`), so a guest who replies reaches Kai. Operator messages are sent from the ops number (`WHATSAPP_PHONE_ID_OPS`).

## `bluepass_booking_confirmed`

To: guests who opted in · From: Kai's number

**Body**

```
Hi {{guest_name}}, you're booked on {{trip}} with {{operator}}: {{when}}, {{guests}}. Meet at {{meeting_point}}. Your booking reference is {{reference}}. Reply here with any questions.
```

**Sample values** (Meta asks for one per variable)

- `guest_name`: Mia
- `trip`: Outer Reef Snorkel Day
- `operator`: Reef Runner Charters
- `when`: Saturday 10 October at 8:00am
- `guests`: 2 Adult, 1 Child
- `meeting_point`: Marina Pier B, Cairns
- `reference`: BP-7K3QX9

**Button**

- Type: Visit website · Text: View booking
- URL: Dynamic, `https://bluepass.co/trip/{{1}}` · Sample: https://bluepass.co/trip/abc123

**Reads as**

> Hi Mia, you're booked on Outer Reef Snorkel Day with Reef Runner Charters: Saturday 10 October at 8:00am, 2 Adult, 1 Child. Meet at Marina Pier B, Cairns. Your booking reference is BP-7K3QX9. Reply here with any questions.

## `bluepass_trip_reminder`

To: guests who opted in · From: Kai's number

**Body**

```
Hi {{guest_name}}, a reminder that {{trip}} leaves {{when}}. Meet at {{meeting_point}}. {{note}} Your booking reference is {{reference}} if the crew asks.
```

**Sample values** (Meta asks for one per variable)

- `guest_name`: Mia
- `trip`: Outer Reef Snorkel Day
- `when`: tomorrow at 8:00am
- `meeting_point`: Marina Pier B, Cairns
- `note`: Check in 30 minutes early and bring reef-safe sunscreen.
- `reference`: BP-7K3QX9

**Button**

- Type: Visit website · Text: View booking
- URL: Dynamic, `https://bluepass.co/trip/{{1}}` · Sample: https://bluepass.co/trip/abc123

**Reads as**

> Hi Mia, a reminder that Outer Reef Snorkel Day leaves tomorrow at 8:00am. Meet at Marina Pier B, Cairns. Check in 30 minutes early and bring reef-safe sunscreen. Your booking reference is BP-7K3QX9 if the crew asks.

## `bluepass_booking_cancelled`

To: guests who opted in · From: Kai's number

**Body**

```
Hi {{guest_name}}, your booking {{reference}} for {{trip}} on {{when}} has been cancelled. Reason: {{reason}}. {{refund}} Reply here if you would like another date.
```

**Sample values** (Meta asks for one per variable)

- `guest_name`: Mia
- `reference`: BP-7K3QX9
- `trip`: Outer Reef Snorkel Day
- `when`: Saturday 10 October
- `reason`: Weather conditions are unsafe
- `refund`: Your A$378 is on its way back to your card.

**Reads as**

> Hi Mia, your booking BP-7K3QX9 for Outer Reef Snorkel Day on Saturday 10 October has been cancelled. Reason: Weather conditions are unsafe. Your A$378 is on its way back to your card. Reply here if you would like another date.

## `bluepass_departure_update`

To: guests who opted in · From: Kai's number

**Body**

```
Hi {{guest_name}}, an update from {{operator}} about {{trip}} on {{when}}: {{message}} Reply here if you have any questions.
```

**Sample values** (Meta asks for one per variable)

- `guest_name`: Mia
- `operator`: Reef Runner Charters
- `trip`: Outer Reef Snorkel Day
- `when`: Saturday 10 October at 8:00am
- `message`: We are now leaving from Pier C, two berths along from the usual spot.

**Button**

- Type: Visit website · Text: View booking
- URL: Dynamic, `https://bluepass.co/trip/{{1}}` · Sample: https://bluepass.co/trip/abc123

**Reads as**

> Hi Mia, an update from Reef Runner Charters about Outer Reef Snorkel Day on Saturday 10 October at 8:00am: We are now leaving from Pier C, two berths along from the usual spot. Reply here if you have any questions.

## `bluepass_operator_new_booking`

To: operators · From: the ops number

**Body**

```
New booking for {{trip}}, {{when}}: {{guests}} with {{lead_guest}}. That departure now has {{booked}} booked.
```

**Sample values** (Meta asks for one per variable)

- `trip`: Outer Reef Snorkel Day
- `when`: Saturday 10 October at 8:00am
- `guests`: 3 guests
- `lead_guest`: Mia Torres (+61 411 204 118)
- `booked`: 10 of 14

**Button**

- Type: Visit website · Text: Open manifest
- URL: Dynamic, `https://bluepass.co/operator/m/{{1}}` · Sample: https://bluepass.co/operator/m/abc_1791410400000

**Reads as**

> New booking for Outer Reef Snorkel Day, Saturday 10 October at 8:00am: 3 guests with Mia Torres (+61 411 204 118). That departure now has 10 of 14 booked.

## `bluepass_operator_tomorrow`

To: operators · From: the ops number

**Body**

```
Tomorrow, {{date}}: {{departures}}. {{total_guests}} booked in all.
```

**Sample values** (Meta asks for one per variable)

- `date`: Saturday 10 October
- `departures`: Outer Reef Snorkel Day 8:00am, 12 guests; Sunset Sail 5:00pm, 4 guests
- `total_guests`: 16 guests

**Button**

- Type: Visit website · Text: Open calendar
- URL: Static, https://bluepass.co/operator/calendar

**Reads as**

> Tomorrow, Saturday 10 October: Outer Reef Snorkel Day 8:00am, 12 guests; Sunset Sail 5:00pm, 4 guests. 16 guests booked in all.

