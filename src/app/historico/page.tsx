"use client";

import { useEffect, useState } from "react";
import { listContacts, type Contact } from "@/lib/contacts";
import { listPlaces, type Place } from "@/lib/places";
import { listShifts, type Shift } from "@/lib/shifts";
import { listObligations, type Obligation } from "@/lib/obligations";
import { HistorySkeleton } from "@/components/ui/skeletons";
import HistoryView from "./history-view";

export default function HistoricoPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      listShifts(),
      listPlaces(),
      listObligations(),
      listContacts(),
    ])
      .then(([s, p, o, c]) => {
        if (!active) return;
        setShifts(s);
        setPlaces(p);
        setObligations(o);
        setContacts(c);
      })
      .catch((err) => {
        console.error("Erro ao carregar histórico:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <HistorySkeleton />;
  }

  return (
    <HistoryView
      shifts={shifts}
      places={places}
      obligations={obligations}
      contacts={contacts}
    />
  );
}

