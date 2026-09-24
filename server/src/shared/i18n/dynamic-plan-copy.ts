export const CONTROL_IDS = [
    'sites', 'keywords_tracked', 'audits', 'audit_pages', 'backlink_rows',
    'competitor_lookups', 'keyword_lookups', 'local_listing_checks',
    'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks',
    'competitor_content_runs', 'trend_explorations', 'traffic_snapshots',
    'link_intel_checks', 'review_syncs', 'brand_mention_scans',
    'keyword_cluster_runs', 'cannibalization_reports', 'alt_engine_checks',
    'toxicity_reviews', 'internal_link_runs', 'content_briefs', 'geogrid_scans',
    'schema_generations', 'ai_chat_messages', 'altEngineKeywordSlots',
    'keywordResearch', 'backlinks', 'competitors', 'localSeo', 'assistant',
    'seats', 'rankCadence',
] as const;
type ControlId = (typeof CONTROL_IDS)[number];
interface DynamicPlanCopy {
    controls: Record<ControlId, string>;
    units: {
        activeSite: string;
        trackedKeyword: string;
        monthlyAllowance: string;
        pagesPerAudit: string;
        alternateKeywordSlot: string;
        capabilityToggle: string;
        seat: string;
        rankCadence: string;
    };
    readiness: {
        preview_only: string;
        checkout_ready: string;
    };
    lifecycle: {
        paymentPending: string;
        active: string;
        grace: string;
        paused: string;
        compensating: string;
        canceled: string;
        refunded: string;
    };
    renewal: {
        honorLocked: string;
        replacementRequired: string;
        urgentStop: string;
        cancellationPending: string;
        cancellationConfirmed: string;
        checkoutReady: string;
        nonRenewing: string;
    };
    labels: {
        annualDiscount: string;
        tax: string;
    };
    validation: {
        unknownControl: string;
        duplicateControl: string;
        invalidValue: string;
        outOfBounds: string;
        offStep: string;
        missingDependency: string;
        conflict: string;
        emptyPlan: string;
        unavailableControl: string;
        pricingUnavailable: string;
        noCommercialOffer: string;
        annualUnavailable: string;
    };
    errors: {
        unavailable: string;
        quoteUnavailable: string;
        annualUnavailable: string;
        invalidSelection: string;
        quoteMintingUnavailable: string;
        idempotencyConflict: string;
        idempotencyKey: string;
        requestTooLarge: string;
        rateLimited: string;
        renewalUnavailable: string;
    };
}
const sharedEnglish = {
    readiness: {
        preview_only: 'Preview is available. Checkout is not ready yet.',
        checkout_ready: 'This plan can be quoted for checkout.',
    },
    lifecycle: {
        paymentPending: 'Payment is being verified. Access will start only after the paid order is confirmed.',
        active: 'Your custom plan is active.',
        grace: 'Payment is overdue. Access is read-only during the grace period.',
        paused: 'Your custom plan is paused. Paid features are unavailable.',
        compensating: 'Payment could not be activated safely. A full refund is being processed.',
        canceled: 'Your custom plan has been canceled.',
        refunded: 'The payment was refunded and paid access has ended.',
    },
    renewal: {
        honorLocked: 'Your current price remains safe for the next renewal.',
        replacementRequired: 'Your renewal price needs to change. Review a fresh offer before the deadline.',
        urgentStop: 'Costs changed close to renewal. Your paid access is unchanged, but renewal will stop unless a safe replacement is purchased.',
        cancellationPending: 'We are confirming the period-end stop with the payment provider.',
        cancellationConfirmed: 'Renewal is stopped. Your paid access continues through the current period.',
        checkoutReady: 'Your current paid period has ended. Review the fresh price before checkout.',
        nonRenewing: 'This plan will not renew. Access continues through the paid period.',
    },
    labels: {
        annualDiscount: 'Annual savings are calculated against twelve monthly payments. The exact rate is shown with the total.',
        tax: 'Tax treatment is confirmed before checkout. This preview is not a tax invoice.',
    },
    validation: {
        unknownControl: 'That plan option is not available.',
        duplicateControl: 'Choose each plan option only once.',
        invalidValue: 'Enter a whole number in the required format.',
        outOfBounds: 'That amount is outside the available range.',
        offStep: 'Choose an amount that matches the listed increment.',
        missingDependency: 'This option needs another plan option.',
        conflict: 'These plan options cannot be combined.',
        emptyPlan: 'Choose at least one paid workflow.',
        unavailableControl: 'That option is temporarily unavailable.',
        pricingUnavailable: 'A safe price cannot be calculated right now.',
        noCommercialOffer: 'This selection needs an assisted plan. Contact sales.',
        annualUnavailable: 'An annual offer is not safely available for this selection.',
    },
    errors: {
        unavailable: 'Custom-plan previews are temporarily unavailable.',
        quoteUnavailable: 'That quote is unavailable or has expired.',
        annualUnavailable: 'An annual quote is not available for this selection.',
        invalidSelection: 'Check the selected plan options and try again.',
        quoteMintingUnavailable: 'Checkout quotes are temporarily unavailable.',
        idempotencyConflict: 'That request key was already used for a different quote.',
        idempotencyKey: 'Send a valid Idempotency-Key header and try again.',
        requestTooLarge: 'The custom-plan request is too large.',
        rateLimited: 'Too many custom-plan requests. Try again shortly.',
        renewalUnavailable: 'That renewal or replacement offer is not available.',
    },
} satisfies Omit<DynamicPlanCopy, 'controls' | 'units'>;
const en: DynamicPlanCopy = {
    controls: {
        sites: 'Sites', keywords_tracked: 'Tracked keywords', audits: 'Site audits', audit_pages: 'Pages per audit', backlink_rows: 'Backlink rows', competitor_lookups: 'Competitor lookups', keyword_lookups: 'Keyword lookups', local_listing_checks: 'Local listing checks', content_analyses: 'Content analyses', audience_research_runs: 'Audience research runs', content_inventory_page_blocks: 'Content inventory page blocks', competitor_content_runs: 'Competitor content comparisons', trend_explorations: 'Keyword trend explorations', traffic_snapshots: 'Traffic snapshots', link_intel_checks: 'Link intelligence checks', review_syncs: 'Review syncs', brand_mention_scans: 'Brand mention scans', keyword_cluster_runs: 'Keyword clustering runs', cannibalization_reports: 'Cannibalization reports', alt_engine_checks: 'Alternate-engine rank checks', toxicity_reviews: 'Toxic-link reviews', internal_link_runs: 'Internal-link runs', content_briefs: 'Content briefs', geogrid_scans: 'Geogrid scans', schema_generations: 'Schema generations', ai_chat_messages: 'AI assistant messages', altEngineKeywordSlots: 'Alternate-engine keyword slots', keywordResearch: 'Keyword research', backlinks: 'Backlink tools', competitors: 'Competitor tools', localSeo: 'Local SEO tools', assistant: 'AI assistant', seats: 'Team seats', rankCadence: 'Rank tracking cadence',
    },
    units: { activeSite: 'active site', trackedKeyword: 'active tracked keyword', monthlyAllowance: 'per billing month', pagesPerAudit: 'pages per audit', alternateKeywordSlot: 'active alternate-engine keyword', capabilityToggle: 'included capability', seat: 'assigned seat including the owner', rankCadence: 'tracking schedule' },
    ...sharedEnglish,
};
const de: DynamicPlanCopy = {
    controls: {
        sites: 'Websites', keywords_tracked: 'Verfolgte Keywords', audits: 'Website-Audits', audit_pages: 'Seiten pro Audit', backlink_rows: 'Backlink-Zeilen', competitor_lookups: 'Wettbewerberabfragen', keyword_lookups: 'Keyword-Abfragen', local_listing_checks: 'Lokale Eintragsprüfungen', content_analyses: 'Inhaltsanalysen', audience_research_runs: 'Zielgruppenanalysen', content_inventory_page_blocks: 'Seitenblöcke im Inhaltsbestand', competitor_content_runs: 'Wettbewerber-Inhaltsvergleiche', trend_explorations: 'Keyword-Trendanalysen', traffic_snapshots: 'Traffic-Snapshots', link_intel_checks: 'Linkanalysen', review_syncs: 'Bewertungssynchronisierungen', brand_mention_scans: 'Markenerwähnungs-Scans', keyword_cluster_runs: 'Keyword-Clusterläufe', cannibalization_reports: 'Kannibalisierungsberichte', alt_engine_checks: 'Rank-Prüfungen anderer Suchmaschinen', toxicity_reviews: 'Prüfungen schädlicher Links', internal_link_runs: 'Interne Verlinkungsläufe', content_briefs: 'Content-Briefings', geogrid_scans: 'Geogrid-Scans', schema_generations: 'Schema-Erstellungen', ai_chat_messages: 'KI-Assistent-Nachrichten', altEngineKeywordSlots: 'Keyword-Plätze für andere Suchmaschinen', keywordResearch: 'Keyword-Recherche', backlinks: 'Backlink-Werkzeuge', competitors: 'Wettbewerber-Werkzeuge', localSeo: 'Lokale SEO-Werkzeuge', assistant: 'KI-Assistent', seats: 'Teamplätze', rankCadence: 'Rhythmus der Rangverfolgung',
    },
    units: { activeSite: 'aktive Website', trackedKeyword: 'aktiv verfolgtes Keyword', monthlyAllowance: 'pro Abrechnungsmonat', pagesPerAudit: 'Seiten pro Audit', alternateKeywordSlot: 'aktives Keyword einer anderen Suchmaschine', capabilityToggle: 'enthaltene Funktion', seat: 'zugewiesener Platz einschließlich Inhaber', rankCadence: 'Verfolgungsplan' },
    readiness: { preview_only: 'Eine Vorschau ist verfügbar. Checkout ist noch nicht bereit.', checkout_ready: 'Für diesen Plan kann ein Checkout-Angebot erstellt werden.' },
    lifecycle: { paymentPending: 'Die Zahlung wird geprüft. Der Zugriff beginnt erst nach Bestätigung der bezahlten Bestellung.', active: 'Ihr individueller Plan ist aktiv.', grace: 'Die Zahlung ist überfällig. Während der Nachfrist ist der Zugriff schreibgeschützt.', paused: 'Ihr individueller Plan ist pausiert. Bezahlte Funktionen sind nicht verfügbar.', compensating: 'Die Zahlung konnte nicht sicher aktiviert werden. Eine vollständige Erstattung wird bearbeitet.', canceled: 'Ihr individueller Plan wurde gekündigt.', refunded: 'Die Zahlung wurde erstattet und der bezahlte Zugriff ist beendet.' },
    renewal: { honorLocked: 'Ihr aktueller Preis bleibt für die nächste Verlängerung sicher.', replacementRequired: 'Ihr Verlängerungspreis muss angepasst werden. Prüfen Sie vor Ablauf der Frist ein neues Angebot.', urgentStop: 'Die Kosten haben sich kurz vor der Verlängerung geändert. Ihr bezahlter Zugriff bleibt bestehen, die Verlängerung stoppt jedoch ohne sicheren Ersatz.', cancellationPending: 'Wir bestätigen das Vertragsende zum Periodenende beim Zahlungsanbieter.', cancellationConfirmed: 'Die Verlängerung ist gestoppt. Ihr Zugriff läuft bis zum Ende des bezahlten Zeitraums weiter.', checkoutReady: 'Der bezahlte Zeitraum ist beendet. Prüfen Sie den aktuellen Preis vor dem Bezahlen.', nonRenewing: 'Dieser Plan wird nicht verlängert. Der Zugriff bleibt bis zum Periodenende bestehen.' },
    labels: { annualDiscount: 'Die jährliche Ersparnis wird mit zwölf Monatszahlungen verglichen. Der genaue Satz steht beim Gesamtbetrag.', tax: 'Die steuerliche Behandlung wird vor dem Checkout bestätigt. Diese Vorschau ist keine Steuerrechnung.' },
    validation: { unknownControl: 'Diese Planoption ist nicht verfügbar.', duplicateControl: 'Wählen Sie jede Planoption nur einmal.', invalidValue: 'Geben Sie eine ganze Zahl im erforderlichen Format ein.', outOfBounds: 'Dieser Betrag liegt außerhalb des verfügbaren Bereichs.', offStep: 'Wählen Sie einen Betrag im angegebenen Schritt.', missingDependency: 'Diese Option benötigt eine weitere Planoption.', conflict: 'Diese Planoptionen können nicht kombiniert werden.', emptyPlan: 'Wählen Sie mindestens einen kostenpflichtigen Arbeitsablauf.', unavailableControl: 'Diese Option ist vorübergehend nicht verfügbar.', pricingUnavailable: 'Derzeit kann kein sicherer Preis berechnet werden.', noCommercialOffer: 'Diese Auswahl benötigt einen betreuten Plan. Kontaktieren Sie den Vertrieb.', annualUnavailable: 'Für diese Auswahl ist kein sicheres Jahresangebot verfügbar.' },
    errors: { unavailable: 'Vorschauen für individuelle Pläne sind vorübergehend nicht verfügbar.', quoteUnavailable: 'Dieses Angebot ist nicht verfügbar oder abgelaufen.', annualUnavailable: 'Für diese Auswahl ist kein Jahresangebot verfügbar.', invalidSelection: 'Prüfen Sie die Planoptionen und versuchen Sie es erneut.', quoteMintingUnavailable: 'Checkout-Angebote sind vorübergehend nicht verfügbar.', idempotencyConflict: 'Dieser Anfrageschlüssel wurde bereits für ein anderes Angebot verwendet.', idempotencyKey: 'Senden Sie einen gültigen Idempotency-Key-Header.', requestTooLarge: 'Die Anfrage für den individuellen Plan ist zu groß.', rateLimited: 'Zu viele Anfragen für individuelle Pläne. Versuchen Sie es gleich erneut.', renewalUnavailable: 'Dieses Verlängerungs- oder Ersatzangebot ist nicht verfügbar.' },
};
const fr: DynamicPlanCopy = {
    controls: {
        sites: 'Sites', keywords_tracked: 'Mots-clés suivis', audits: 'Audits de site', audit_pages: 'Pages par audit', backlink_rows: 'Lignes de backlinks', competitor_lookups: 'Recherches de concurrents', keyword_lookups: 'Recherches de mots-clés', local_listing_checks: 'Contrôles de fiches locales', content_analyses: 'Analyses de contenu', audience_research_runs: 'Recherches d’audience', content_inventory_page_blocks: 'Blocs de pages d’inventaire', competitor_content_runs: 'Comparaisons de contenu concurrent', trend_explorations: 'Explorations de tendances', traffic_snapshots: 'Instantanés de trafic', link_intel_checks: 'Contrôles de liens', review_syncs: 'Synchronisations d’avis', brand_mention_scans: 'Analyses de mentions de marque', keyword_cluster_runs: 'Regroupements de mots-clés', cannibalization_reports: 'Rapports de cannibalisation', alt_engine_checks: 'Contrôles sur moteurs alternatifs', toxicity_reviews: 'Analyses de liens toxiques', internal_link_runs: 'Analyses de liens internes', content_briefs: 'Briefs de contenu', geogrid_scans: 'Analyses géographiques', schema_generations: 'Générations de schéma', ai_chat_messages: 'Messages de l’assistant IA', altEngineKeywordSlots: 'Emplacements de mots-clés alternatifs', keywordResearch: 'Recherche de mots-clés', backlinks: 'Outils de backlinks', competitors: 'Outils concurrents', localSeo: 'Outils de SEO local', assistant: 'Assistant IA', seats: 'Places d’équipe', rankCadence: 'Fréquence du suivi de position',
    },
    units: { activeSite: 'site actif', trackedKeyword: 'mot-clé actif suivi', monthlyAllowance: 'par mois de facturation', pagesPerAudit: 'pages par audit', alternateKeywordSlot: 'mot-clé actif sur un autre moteur', capabilityToggle: 'fonction incluse', seat: 'place attribuée, propriétaire inclus', rankCadence: 'calendrier de suivi' },
    readiness: { preview_only: 'L’aperçu est disponible. Le paiement ne l’est pas encore.', checkout_ready: 'Ce plan peut recevoir un devis pour paiement.' },
    lifecycle: { paymentPending: 'Le paiement est en cours de vérification. L’accès commencera après confirmation de la commande payée.', active: 'Votre plan personnalisé est actif.', grace: 'Le paiement est en retard. L’accès reste en lecture seule pendant le délai de grâce.', paused: 'Votre plan personnalisé est suspendu. Les fonctions payantes sont indisponibles.', compensating: 'Le paiement n’a pas pu être activé en toute sécurité. Un remboursement intégral est en cours.', canceled: 'Votre plan personnalisé a été résilié.', refunded: 'Le paiement a été remboursé et l’accès payant est terminé.' },
    renewal: { honorLocked: 'Votre prix actuel reste sûr pour le prochain renouvellement.', replacementRequired: 'Le prix de renouvellement doit changer. Consultez une nouvelle offre avant l’échéance.', urgentStop: 'Les coûts ont changé peu avant le renouvellement. Votre accès payé reste inchangé, mais le renouvellement s’arrêtera sans remplacement sûr.', cancellationPending: 'Nous confirmons l’arrêt en fin de période auprès du prestataire de paiement.', cancellationConfirmed: 'Le renouvellement est arrêté. Votre accès continue jusqu’à la fin de la période payée.', checkoutReady: 'Votre période payée est terminée. Vérifiez le prix actuel avant de payer.', nonRenewing: 'Ce plan ne sera pas renouvelé. L’accès continue jusqu’à la fin de la période payée.' },
    labels: { annualDiscount: 'L’économie annuelle est calculée face à douze paiements mensuels. Le taux exact accompagne le total.', tax: 'Le traitement fiscal est confirmé avant le paiement. Cet aperçu n’est pas une facture fiscale.' },
    validation: { unknownControl: 'Cette option de plan n’est pas disponible.', duplicateControl: 'Choisissez chaque option une seule fois.', invalidValue: 'Saisissez un nombre entier au format demandé.', outOfBounds: 'Cette quantité sort de la plage disponible.', offStep: 'Choisissez une quantité correspondant au pas indiqué.', missingDependency: 'Cette option nécessite une autre option du plan.', conflict: 'Ces options ne peuvent pas être combinées.', emptyPlan: 'Choisissez au moins un flux payant.', unavailableControl: 'Cette option est temporairement indisponible.', pricingUnavailable: 'Impossible de calculer un prix sûr pour le moment.', noCommercialOffer: 'Cette sélection nécessite un plan accompagné. Contactez les ventes.', annualUnavailable: 'Aucune offre annuelle sûre n’est disponible pour cette sélection.' },
    errors: { unavailable: 'Les aperçus de plans personnalisés sont temporairement indisponibles.', quoteUnavailable: 'Ce devis est indisponible ou a expiré.', annualUnavailable: 'Aucun devis annuel n’est disponible pour cette sélection.', invalidSelection: 'Vérifiez les options choisies et réessayez.', quoteMintingUnavailable: 'Les devis de paiement sont temporairement indisponibles.', idempotencyConflict: 'Cette clé de requête a déjà servi pour un autre devis.', idempotencyKey: 'Envoyez un en-tête Idempotency-Key valide.', requestTooLarge: 'La demande de plan personnalisé est trop volumineuse.', rateLimited: 'Trop de demandes de plan personnalisé. Réessayez bientôt.', renewalUnavailable: 'Cette offre de renouvellement ou de remplacement n’est pas disponible.' },
};
const es: DynamicPlanCopy = {
    controls: {
        sites: 'Sitios', keywords_tracked: 'Palabras clave seguidas', audits: 'Auditorías del sitio', audit_pages: 'Páginas por auditoría', backlink_rows: 'Filas de backlinks', competitor_lookups: 'Consultas de competidores', keyword_lookups: 'Consultas de palabras clave', local_listing_checks: 'Comprobaciones de fichas locales', content_analyses: 'Análisis de contenido', audience_research_runs: 'Investigaciones de audiencia', content_inventory_page_blocks: 'Bloques de páginas del inventario', competitor_content_runs: 'Comparaciones de contenido competidor', trend_explorations: 'Exploraciones de tendencias', traffic_snapshots: 'Instantáneas de tráfico', link_intel_checks: 'Comprobaciones de enlaces', review_syncs: 'Sincronizaciones de reseñas', brand_mention_scans: 'Escaneos de menciones de marca', keyword_cluster_runs: 'Agrupaciones de palabras clave', cannibalization_reports: 'Informes de canibalización', alt_engine_checks: 'Comprobaciones en motores alternativos', toxicity_reviews: 'Revisiones de enlaces tóxicos', internal_link_runs: 'Análisis de enlaces internos', content_briefs: 'Briefs de contenido', geogrid_scans: 'Escaneos geográficos', schema_generations: 'Generaciones de schema', ai_chat_messages: 'Mensajes del asistente de IA', altEngineKeywordSlots: 'Espacios de palabras clave en otros motores', keywordResearch: 'Investigación de palabras clave', backlinks: 'Herramientas de backlinks', competitors: 'Herramientas de competidores', localSeo: 'Herramientas de SEO local', assistant: 'Asistente de IA', seats: 'Plazas del equipo', rankCadence: 'Frecuencia del seguimiento',
    },
    units: { activeSite: 'sitio activo', trackedKeyword: 'palabra clave activa', monthlyAllowance: 'por mes de facturación', pagesPerAudit: 'páginas por auditoría', alternateKeywordSlot: 'palabra clave activa en otro motor', capabilityToggle: 'función incluida', seat: 'plaza asignada, incluido el propietario', rankCadence: 'calendario de seguimiento' },
    readiness: { preview_only: 'La vista previa está disponible. El pago aún no está listo.', checkout_ready: 'Este plan puede recibir un presupuesto para el pago.' },
    lifecycle: { paymentPending: 'El pago se está verificando. El acceso comenzará cuando se confirme el pedido pagado.', active: 'Tu plan personalizado está activo.', grace: 'El pago está vencido. Durante el periodo de gracia, el acceso es de solo lectura.', paused: 'Tu plan personalizado está pausado. Las funciones de pago no están disponibles.', compensating: 'El pago no pudo activarse de forma segura. Se está procesando un reembolso completo.', canceled: 'Tu plan personalizado se ha cancelado.', refunded: 'El pago se ha reembolsado y el acceso de pago ha terminado.' },
    renewal: { honorLocked: 'Tu precio actual sigue siendo seguro para la próxima renovación.', replacementRequired: 'El precio de renovación debe cambiar. Revisa una oferta nueva antes de la fecha límite.', urgentStop: 'Los costes cambiaron cerca de la renovación. Tu acceso pagado no cambia, pero la renovación se detendrá sin un reemplazo seguro.', cancellationPending: 'Estamos confirmando la cancelación al final del periodo con el proveedor de pagos.', cancellationConfirmed: 'La renovación está detenida. Tu acceso continúa hasta el final del periodo pagado.', checkoutReady: 'Tu periodo pagado ha terminado. Revisa el precio actual antes de pagar.', nonRenewing: 'Este plan no se renovará. El acceso continúa hasta el final del periodo pagado.' },
    labels: { annualDiscount: 'El ahorro anual se calcula frente a doce pagos mensuales. La tasa exacta aparece con el total.', tax: 'El tratamiento fiscal se confirma antes del pago. Esta vista previa no es una factura fiscal.' },
    validation: { unknownControl: 'Esa opción del plan no está disponible.', duplicateControl: 'Elige cada opción solo una vez.', invalidValue: 'Introduce un número entero con el formato requerido.', outOfBounds: 'Esa cantidad está fuera del intervalo disponible.', offStep: 'Elige una cantidad que respete el incremento indicado.', missingDependency: 'Esta opción necesita otra opción del plan.', conflict: 'Estas opciones no se pueden combinar.', emptyPlan: 'Elige al menos un flujo de trabajo de pago.', unavailableControl: 'Esa opción no está disponible temporalmente.', pricingUnavailable: 'Ahora no se puede calcular un precio seguro.', noCommercialOffer: 'Esta selección necesita un plan asistido. Contacta con ventas.', annualUnavailable: 'No hay una oferta anual segura para esta selección.' },
    errors: { unavailable: 'Las vistas previas de planes personalizados no están disponibles temporalmente.', quoteUnavailable: 'Ese presupuesto no está disponible o ha caducado.', annualUnavailable: 'No hay presupuesto anual para esta selección.', invalidSelection: 'Revisa las opciones elegidas e inténtalo de nuevo.', quoteMintingUnavailable: 'Los presupuestos para el pago no están disponibles temporalmente.', idempotencyConflict: 'Esa clave de solicitud ya se usó para otro presupuesto.', idempotencyKey: 'Envía un encabezado Idempotency-Key válido.', requestTooLarge: 'La solicitud del plan personalizado es demasiado grande.', rateLimited: 'Demasiadas solicitudes de planes personalizados. Inténtalo de nuevo pronto.', renewalUnavailable: 'Esa oferta de renovación o reemplazo no está disponible.' },
};
const ar: DynamicPlanCopy = {
    controls: {
        sites: 'المواقع', keywords_tracked: 'الكلمات المفتاحية المتتبعة', audits: 'عمليات تدقيق الموقع', audit_pages: 'الصفحات لكل تدقيق', backlink_rows: 'صفوف الروابط الخلفية', competitor_lookups: 'عمليات بحث المنافسين', keyword_lookups: 'عمليات بحث الكلمات المفتاحية', local_listing_checks: 'فحوصات القوائم المحلية', content_analyses: 'تحليلات المحتوى', audience_research_runs: 'عمليات بحث الجمهور', content_inventory_page_blocks: 'كتل صفحات مخزون المحتوى', competitor_content_runs: 'مقارنات محتوى المنافسين', trend_explorations: 'استكشافات الاتجاهات', traffic_snapshots: 'لقطات حركة المرور', link_intel_checks: 'فحوصات الروابط', review_syncs: 'مزامنة المراجعات', brand_mention_scans: 'فحوصات ذكر العلامة', keyword_cluster_runs: 'عمليات تجميع الكلمات', cannibalization_reports: 'تقارير تنافس الصفحات', alt_engine_checks: 'فحوصات الترتيب في المحركات البديلة', toxicity_reviews: 'مراجعات الروابط الضارة', internal_link_runs: 'عمليات الربط الداخلي', content_briefs: 'ملخصات المحتوى', geogrid_scans: 'فحوصات الشبكة الجغرافية', schema_generations: 'إنشاءات البيانات المنظمة', ai_chat_messages: 'رسائل مساعد الذكاء الاصطناعي', altEngineKeywordSlots: 'خانات كلمات المحركات البديلة', keywordResearch: 'بحث الكلمات المفتاحية', backlinks: 'أدوات الروابط الخلفية', competitors: 'أدوات المنافسين', localSeo: 'أدوات تحسين البحث المحلي', assistant: 'مساعد الذكاء الاصطناعي', seats: 'مقاعد الفريق', rankCadence: 'وتيرة تتبع الترتيب',
    },
    units: { activeSite: 'موقع نشط', trackedKeyword: 'كلمة مفتاحية نشطة', monthlyAllowance: 'لكل شهر فوترة', pagesPerAudit: 'صفحات لكل تدقيق', alternateKeywordSlot: 'كلمة نشطة في محرك بديل', capabilityToggle: 'ميزة مضمنة', seat: 'مقعد مخصص يشمل المالك', rankCadence: 'جدول التتبع' },
    readiness: { preview_only: 'المعاينة متاحة، لكن الدفع غير جاهز بعد.', checkout_ready: 'يمكن إصدار عرض دفع لهذه الخطة.' },
    lifecycle: { paymentPending: 'يجري التحقق من الدفع. لن يبدأ الوصول إلا بعد تأكيد الطلب المدفوع.', active: 'خطتك المخصصة نشطة.', grace: 'تأخر الدفع. يكون الوصول للقراءة فقط خلال فترة السماح.', paused: 'خطتك المخصصة متوقفة مؤقتاً. الميزات المدفوعة غير متاحة.', compensating: 'تعذر تفعيل الدفع بأمان. تجري معالجة استرداد كامل.', canceled: 'أُلغيت خطتك المخصصة.', refunded: 'استُردت الدفعة وانتهى الوصول المدفوع.' },
    renewal: { honorLocked: 'يبقى سعرك الحالي آمناً للتجديد القادم.', replacementRequired: 'يجب تغيير سعر التجديد. راجع عرضاً جديداً قبل الموعد النهائي.', urgentStop: 'تغيّرت التكاليف قرب موعد التجديد. لن يتغير وصولك المدفوع، لكن التجديد سيتوقف من دون بديل آمن.', cancellationPending: 'نتحقق مع مزود الدفع من الإيقاف عند نهاية الفترة.', cancellationConfirmed: 'توقف التجديد. يستمر وصولك حتى نهاية الفترة المدفوعة.', checkoutReady: 'انتهت فترتك المدفوعة. راجع السعر الحالي قبل الدفع.', nonRenewing: 'لن تتجدد هذه الخطة. يستمر الوصول حتى نهاية الفترة المدفوعة.' },
    labels: { annualDiscount: 'يُحسب التوفير السنوي مقارنة باثنتي عشرة دفعة شهرية، وتظهر النسبة الدقيقة مع الإجمالي.', tax: 'يتم تأكيد المعالجة الضريبية قبل الدفع. هذه المعاينة ليست فاتورة ضريبية.' },
    validation: { unknownControl: 'خيار الخطة هذا غير متاح.', duplicateControl: 'اختر كل خيار مرة واحدة فقط.', invalidValue: 'أدخل عدداً صحيحاً بالتنسيق المطلوب.', outOfBounds: 'هذه الكمية خارج النطاق المتاح.', offStep: 'اختر كمية تطابق الزيادة الموضحة.', missingDependency: 'يتطلب هذا الخيار خياراً آخر في الخطة.', conflict: 'لا يمكن الجمع بين هذه الخيارات.', emptyPlan: 'اختر سير عمل مدفوعاً واحداً على الأقل.', unavailableControl: 'هذا الخيار غير متاح مؤقتاً.', pricingUnavailable: 'لا يمكن حساب سعر آمن الآن.', noCommercialOffer: 'يتطلب هذا الاختيار خطة بمساعدة فريق المبيعات.', annualUnavailable: 'لا يتوفر عرض سنوي آمن لهذا الاختيار.' },
    errors: { unavailable: 'معاينات الخطط المخصصة غير متاحة مؤقتاً.', quoteUnavailable: 'عرض السعر غير متاح أو انتهت صلاحيته.', annualUnavailable: 'لا يتوفر عرض سنوي لهذا الاختيار.', invalidSelection: 'راجع خيارات الخطة وحاول مرة أخرى.', quoteMintingUnavailable: 'عروض الدفع غير متاحة مؤقتاً.', idempotencyConflict: 'استُخدم مفتاح الطلب هذا لعرض سعر مختلف.', idempotencyKey: 'أرسل ترويسة Idempotency-Key صالحة.', requestTooLarge: 'طلب الخطة المخصصة كبير جداً.', rateLimited: 'طلبات خطط مخصصة كثيرة جداً. حاول مرة أخرى قريباً.', renewalUnavailable: 'عرض التجديد أو الاستبدال هذا غير متاح.' },
};
const ru: DynamicPlanCopy = {
    controls: {
        sites: 'Сайты', keywords_tracked: 'Отслеживаемые ключевые слова', audits: 'Аудиты сайта', audit_pages: 'Страниц на аудит', backlink_rows: 'Строки обратных ссылок', competitor_lookups: 'Запросы конкурентов', keyword_lookups: 'Запросы ключевых слов', local_listing_checks: 'Проверки локальных карточек', content_analyses: 'Анализы контента', audience_research_runs: 'Исследования аудитории', content_inventory_page_blocks: 'Блоки страниц инвентаризации', competitor_content_runs: 'Сравнения контента конкурентов', trend_explorations: 'Исследования трендов', traffic_snapshots: 'Снимки трафика', link_intel_checks: 'Проверки ссылок', review_syncs: 'Синхронизации отзывов', brand_mention_scans: 'Сканирования упоминаний бренда', keyword_cluster_runs: 'Кластеризации ключевых слов', cannibalization_reports: 'Отчёты о каннибализации', alt_engine_checks: 'Проверки позиций в других системах', toxicity_reviews: 'Проверки токсичных ссылок', internal_link_runs: 'Запуски внутренней перелинковки', content_briefs: 'Контент-брифы', geogrid_scans: 'Геосеточные сканирования', schema_generations: 'Генерации разметки', ai_chat_messages: 'Сообщения ИИ-помощника', altEngineKeywordSlots: 'Слоты ключевых слов других систем', keywordResearch: 'Исследование ключевых слов', backlinks: 'Инструменты обратных ссылок', competitors: 'Инструменты конкурентов', localSeo: 'Инструменты локального SEO', assistant: 'ИИ-помощник', seats: 'Места в команде', rankCadence: 'Частота отслеживания позиций',
    },
    units: { activeSite: 'активный сайт', trackedKeyword: 'активное ключевое слово', monthlyAllowance: 'за расчётный месяц', pagesPerAudit: 'страниц на аудит', alternateKeywordSlot: 'активное слово другой системы', capabilityToggle: 'включённая функция', seat: 'назначенное место, включая владельца', rankCadence: 'расписание отслеживания' },
    readiness: { preview_only: 'Предварительный расчёт доступен. Оплата пока не готова.', checkout_ready: 'Для этого плана можно создать предложение к оплате.' },
    lifecycle: { paymentPending: 'Платёж проверяется. Доступ откроется только после подтверждения оплаченного заказа.', active: 'Ваш индивидуальный план активен.', grace: 'Платёж просрочен. В течение льготного периода доступ доступен только для чтения.', paused: 'Ваш индивидуальный план приостановлен. Платные функции недоступны.', compensating: 'Платёж не удалось безопасно активировать. Выполняется полный возврат.', canceled: 'Ваш индивидуальный план отменён.', refunded: 'Платёж возвращён, платный доступ завершён.' },
    renewal: { honorLocked: 'Текущая цена остаётся безопасной для следующего продления.', replacementRequired: 'Цена продления должна измениться. Проверьте новое предложение до крайнего срока.', urgentStop: 'Расходы изменились незадолго до продления. Оплаченный доступ не меняется, но без безопасной замены продление остановится.', cancellationPending: 'Мы подтверждаем у платёжного провайдера остановку в конце периода.', cancellationConfirmed: 'Продление остановлено. Доступ сохранится до конца оплаченного периода.', checkoutReady: 'Оплаченный период завершён. Проверьте актуальную цену перед оплатой.', nonRenewing: 'Этот план не будет продлён. Доступ сохранится до конца оплаченного периода.' },
    labels: { annualDiscount: 'Годовая экономия сравнивается с двенадцатью ежемесячными платежами. Точная ставка указана рядом с итогом.', tax: 'Налоговый режим подтверждается перед оплатой. Этот расчёт не является налоговым счётом.' },
    validation: { unknownControl: 'Этот параметр плана недоступен.', duplicateControl: 'Выбирайте каждый параметр только один раз.', invalidValue: 'Введите целое число в требуемом формате.', outOfBounds: 'Значение находится вне доступного диапазона.', offStep: 'Выберите значение с указанным шагом.', missingDependency: 'Для этого параметра нужен другой параметр плана.', conflict: 'Эти параметры нельзя объединить.', emptyPlan: 'Выберите хотя бы один платный процесс.', unavailableControl: 'Этот параметр временно недоступен.', pricingUnavailable: 'Сейчас невозможно безопасно рассчитать цену.', noCommercialOffer: 'Для этого набора нужен план с участием отдела продаж.', annualUnavailable: 'Для этого набора нет безопасного годового предложения.' },
    errors: { unavailable: 'Расчёты индивидуальных планов временно недоступны.', quoteUnavailable: 'Предложение недоступно или истекло.', annualUnavailable: 'Для этого набора нет годового предложения.', invalidSelection: 'Проверьте параметры плана и повторите попытку.', quoteMintingUnavailable: 'Предложения к оплате временно недоступны.', idempotencyConflict: 'Этот ключ запроса уже использован для другого предложения.', idempotencyKey: 'Отправьте допустимый заголовок Idempotency-Key.', requestTooLarge: 'Запрос индивидуального плана слишком велик.', rateLimited: 'Слишком много запросов индивидуального плана. Повторите позже.', renewalUnavailable: 'Это предложение продления или замены недоступно.' },
};
const zh: DynamicPlanCopy = {
    controls: {
        sites: '网站', keywords_tracked: '跟踪关键词', audits: '网站审计', audit_pages: '每次审计页数', backlink_rows: '反向链接行数', competitor_lookups: '竞争对手查询', keyword_lookups: '关键词查询', local_listing_checks: '本地商家信息检查', content_analyses: '内容分析', audience_research_runs: '受众研究', content_inventory_page_blocks: '内容清单页面块', competitor_content_runs: '竞争对手内容比较', trend_explorations: '关键词趋势探索', traffic_snapshots: '流量快照', link_intel_checks: '链接情报检查', review_syncs: '评论同步', brand_mention_scans: '品牌提及扫描', keyword_cluster_runs: '关键词聚类', cannibalization_reports: '关键词蚕食报告', alt_engine_checks: '其他搜索引擎排名检查', toxicity_reviews: '有害链接审查', internal_link_runs: '内部链接分析', content_briefs: '内容简报', geogrid_scans: '地理网格扫描', schema_generations: '结构化数据生成', ai_chat_messages: 'AI 助手消息', altEngineKeywordSlots: '其他搜索引擎关键词位', keywordResearch: '关键词研究', backlinks: '反向链接工具', competitors: '竞争对手工具', localSeo: '本地 SEO 工具', assistant: 'AI 助手', seats: '团队席位', rankCadence: '排名跟踪频率',
    },
    units: { activeSite: '活跃网站', trackedKeyword: '活跃跟踪关键词', monthlyAllowance: '每个计费月', pagesPerAudit: '每次审计页数', alternateKeywordSlot: '其他搜索引擎活跃关键词', capabilityToggle: '已包含功能', seat: '分配席位（含所有者）', rankCadence: '跟踪计划' },
    readiness: { preview_only: '可以预览，但结账尚未就绪。', checkout_ready: '此方案可以生成结账报价。' },
    lifecycle: { paymentPending: '正在核验付款。确认订单已付款后才会开通访问权限。', active: '您的自定义方案已启用。', grace: '付款已逾期。宽限期内仅提供只读访问。', paused: '您的自定义方案已暂停，付费功能不可用。', compensating: '该付款无法安全启用，正在处理全额退款。', canceled: '您的自定义方案已取消。', refunded: '付款已退款，付费访问权限已结束。' },
    renewal: { honorLocked: '您当前的价格对于下次续订仍然安全。', replacementRequired: '续订价格需要调整。请在截止日期前查看新报价。', urgentStop: '成本在临近续订时发生变化。已付款的访问不受影响，但若没有安全的替代方案，续订将停止。', cancellationPending: '我们正在向支付服务商确认在本期结束时停止续订。', cancellationConfirmed: '续订已停止。访问权限将持续到已付款周期结束。', checkoutReady: '已付款周期已结束。付款前请查看最新价格。', nonRenewing: '此方案不会续订。访问权限将持续到已付款周期结束。' },
    labels: { annualDiscount: '年度节省额以十二次月付为基准计算，确切比例与总额一并显示。', tax: '税务处理将在结账前确认。此预览不是税务发票。' },
    validation: { unknownControl: '该方案选项不可用。', duplicateControl: '每个方案选项只能选择一次。', invalidValue: '请按要求输入整数。', outOfBounds: '该数量超出可用范围。', offStep: '请选择符合所列增量的数量。', missingDependency: '此选项需要另一个方案选项。', conflict: '这些方案选项不能组合。', emptyPlan: '请至少选择一个付费工作流。', unavailableControl: '该选项暂时不可用。', pricingUnavailable: '目前无法安全计算价格。', noCommercialOffer: '此选择需要销售协助方案。请联系销售团队。', annualUnavailable: '此选择目前没有安全的年度方案。' },
    errors: { unavailable: '自定义方案预览暂时不可用。', quoteUnavailable: '该报价不可用或已过期。', annualUnavailable: '此选择没有可用的年度报价。', invalidSelection: '请检查所选方案选项后重试。', quoteMintingUnavailable: '结账报价暂时不可用。', idempotencyConflict: '该请求密钥已用于其他报价。', idempotencyKey: '请发送有效的 Idempotency-Key 请求头。', requestTooLarge: '自定义方案请求过大。', rateLimited: '自定义方案请求过多，请稍后重试。', renewalUnavailable: '该续订或替代报价不可用。' },
};
export const DYNAMIC_PLAN_COPY = Object.freeze({ en, ar, fr, de, es, ru, zh });
