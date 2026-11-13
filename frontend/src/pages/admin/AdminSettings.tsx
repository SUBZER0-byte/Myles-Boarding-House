import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { ProfilePictureCard } from "@/components/ProfilePictureCard";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePolling } from "@/hooks/usePolling";
import { useSupabasePolling } from "@/hooks/useSupabasePolling";
import { api, endpoints, sessionStore, API_BASE_URL, type ApiResponse } from "@/lib/api";
import { cropGcashQr } from "@/lib/cropGcashQr";
import { changeMyPassword } from "@/lib/profileSettings";
import {
  getMyAdminSettingsProfile,
  requestAdminEmailChange,
  saveMyAdminSettingsProfile,
  type AdminSettingsProfile,
} from "@/lib/adminProfile";

type Profile = AdminSettingsProfile & { user_type: string };
type Settings = Record<string, string | boolean>;
type AdminApiKeys = {
  ollama_api_key: string;
  textbee_api_key: string;
  paypal_client_id: string;
  paypal_secret: string;
  paypal_webhook_id: string;
};
type PayPalMode = "SANDBOX" | "LIVE" | "Unavailable";
type GcashQrImage = { filename: string; path: string; uploaded_at: number; is_active: boolean; amount: number | null };
type ChatbotFaqCategory = "rates" | "availability" | "house_rules" | "payment_methods" | "reservation_steps" | "location" | "other";
type ChatbotFaq = { faq_id: number; category: ChatbotFaqCategory; question: string; answer: string; is_active: number };
type ChatbotFaqForm = { faq_id: number | null; category: ChatbotFaqCategory; question: string; answer: string; is_active: boolean };
type ChatbotSuggestedQuestion = { suggested_question_id: number; question: string; is_active: number };

const chatbotFaqCategories: { value: ChatbotFaqCategory; label: string }[] = [
  { value: "rates", label: "Rates" },
  { value: "availability", label: "Available rooms" },
  { value: "house_rules", label: "House rules" },
  { value: "payment_methods", label: "Payment methods" },
  { value: "reservation_steps", label: "Reservation steps" },
  { value: "location", label: "Location" },
  { value: "other", label: "Others" },
];

const newChatbotFaq = (): ChatbotFaqForm => ({
  faq_id: null,
  category: "rates",
  question: "",
  answer: "",
  is_active: true,
});

const AdminSettings = () => {
  const { toast } = useToast();
  const session = sessionStore.get();
  const userId = session?.user_id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [apiKeys, setApiKeys] = useState<AdminApiKeys>({
    ollama_api_key: "",
    textbee_api_key: "",
    paypal_client_id: "",
    paypal_secret: "",
    paypal_webhook_id: "",
  });
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({});
  const [visibleTextbeeDeviceId, setVisibleTextbeeDeviceId] = useState(false);
  const [visiblePasswordFields, setVisiblePasswordFields] = useState({ current: false, next: false });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [paymentMode, setPaymentMode] = useState<PayPalMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [houseSaving, setHouseSaving] = useState(false);
  const [gpsSaving, setGpsSaving] = useState(false);
  const [textbeeSaving, setTextbeeSaving] = useState(false);
  const [paypalSaving, setPaypalSaving] = useState(false);
  const [ollamaKeySaving, setOllamaKeySaving] = useState(false);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrAmount, setQrAmount] = useState("");
  const [qrAmountDrafts, setQrAmountDrafts] = useState<Record<string, string>>({});
  const [qrUploading, setQrUploading] = useState(false);
  const [qrAmountSaving, setQrAmountSaving] = useState<string | null>(null);
  const [qrCropping, setQrCropping] = useState(false);
  const [qrCropProgress, setQrCropProgress] = useState("");
  const [qrImages, setQrImages] = useState<GcashQrImage[]>([]);
  const [qrImagesLoading, setQrImagesLoading] = useState(true);
  const [qrToDelete, setQrToDelete] = useState<GcashQrImage | null>(null);
  const [qrDeleting, setQrDeleting] = useState(false);
  const [chatbotFaqs, setChatbotFaqs] = useState<ChatbotFaq[]>([]);
  const [chatbotFaqsLoading, setChatbotFaqsLoading] = useState(true);
  const [chatbotFaqSaving, setChatbotFaqSaving] = useState(false);
  const [chatbotFaqDeleting, setChatbotFaqDeleting] = useState<number | null>(null);
  const [chatbotFaqForm, setChatbotFaqForm] = useState<ChatbotFaqForm>(newChatbotFaq);
  const [chatbotSuggestedQuestions, setChatbotSuggestedQuestions] = useState<ChatbotSuggestedQuestion[]>([]);
  const [chatbotSuggestedQuestionsLoading, setChatbotSuggestedQuestionsLoading] = useState(true);
  const [chatbotSuggestedQuestion, setChatbotSuggestedQuestion] = useState("");
  const [chatbotSuggestedQuestionEditing, setChatbotSuggestedQuestionEditing] = useState<number | null>(null);
  const [chatbotSuggestedQuestionSaving, setChatbotSuggestedQuestionSaving] = useState(false);
  const [chatbotSuggestedQuestionDeleting, setChatbotSuggestedQuestionDeleting] = useState<number | null>(null);
  const loadAdminProfile = useCallback(async () => ({
    ...await getMyAdminSettingsProfile(),
    user_type: "Admin",
  }), []);
  const { data: liveProfile } = useSupabasePolling(loadAdminProfile, 5000, Boolean(userId));
  const { data: liveSettings } = usePolling<Settings>(
    `${endpoints.adminSettings}?action=get_settings`,
    { intervalMs: 5000 }
  );
  const { data: livePaymentMode } = usePolling<{ mode: PayPalMode }>(
    `${endpoints.adminSettings}?action=payment_mode`,
    { intervalMs: 5000 }
  );
  const qrInputRef = useRef<HTMLInputElement>(null);
  const settingText = (key: string): string => {
    const value = settings[key];
    return typeof value === "string" ? value : "";
  };
  const settingTextOrDefault = (key: string, defaultValue: string): string => {
    const value = settings[key];
    return typeof value === "string" && value !== "" ? value : defaultValue;
  };
  const settingEnabled = (key: string, defaultValue: boolean): boolean => {
    const value = settings[key];
    return typeof value === "boolean" ? value : value === undefined ? defaultValue : value === "1";
  };
  const updateApiKeys = useCallback(async () => {
    const response = await api.get<ApiResponse<AdminApiKeys>>(
      `${endpoints.adminSettings}?action=get_admin_api_keys`,
    );
    if (response.data.type !== "success" || !response.data.data) {
      throw new Error(response.data.message ?? "Unable to load API keys");
    }
    setApiKeys(response.data.data);
  }, []);

  const apiKeyField = (label: string, name: keyof AdminApiKeys, editable = false) => (
    <div className="grid gap-1.5" key={name}>
      <Label htmlFor={`admin-api-key-${name}`}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={`admin-api-key-${name}`}
          type={visibleApiKeys[name] ? "text" : "password"}
          autoComplete="off"
          readOnly={!editable}
          value={apiKeys[name]}
          placeholder={apiKeys[name] ? "" : "Not configured"}
          onChange={editable ? event => setApiKeys(current => ({ ...current, [name]: event.target.value })) : undefined}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${visibleApiKeys[name] ? "Hide" : "Show"} ${label}`}
          aria-pressed={visibleApiKeys[name] === true}
          onClick={() => setVisibleApiKeys(current => ({ ...current, [name]: !current[name] }))}
        >
          {visibleApiKeys[name] ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );

  const reloadGcashQrImages = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<{ images: GcashQrImage[] }>>(
        `${endpoints.adminSettings}?action=list_gcash_qrs`,
      );
      if (res.data.type !== "success" || !res.data.data) {
        throw new Error(res.data.message ?? "Unable to load GCash QR images");
      }
      setQrImages(res.data.data.images);
      setQrAmountDrafts(current => Object.fromEntries(
        res.data.data.images.map(image => [
          image.filename,
          current[image.filename] ?? (image.amount === null ? "" : String(image.amount)),
        ]),
      ));
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to load GCash QR images",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setQrImagesLoading(false);
    }
  }, [toast]);

  const loadChatbotFaqs = useCallback(async () => {
    setChatbotFaqsLoading(true);
    try {
      const res = await api.get<ApiResponse<ChatbotFaq[]>>(
        `${endpoints.adminSettings}?action=list_chatbot_faqs`,
      );
      if (res.data.type !== "success" || !res.data.data) {
        throw new Error(res.data.message ?? "Unable to load chatbot FAQs");
      }
      setChatbotFaqs(res.data.data);
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to load chatbot FAQs",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setChatbotFaqsLoading(false);
    }
  }, [toast]);

  const loadChatbotSuggestedQuestions = useCallback(async () => {
    setChatbotSuggestedQuestionsLoading(true);
    try {
      const res = await api.get<ApiResponse<ChatbotSuggestedQuestion[]>>(
        `${endpoints.adminSettings}?action=list_chatbot_suggested_questions`,
      );
      if (res.data.type !== "success" || !res.data.data) {
        throw new Error(res.data.message ?? "Unable to load suggested questions");
      }
      setChatbotSuggestedQuestions(res.data.data);
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to load suggested questions",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setChatbotSuggestedQuestionsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const s = await api.get<ApiResponse<Settings>>(`${endpoints.adminSettings}?action=get_settings`);
      if (s.data.type === "success" && s.data.data) setSettings(s.data.data);
      await loadChatbotFaqs();
      await loadChatbotSuggestedQuestions();
      try {
        await updateApiKeys();
      } catch (error: unknown) {
        toast({
          title: "Unable to load API keys",
          description: error instanceof Error ? error.message : "An unexpected error occurred",
          variant: "destructive",
        });
      }
      setLoading(false);
    })();
    void reloadGcashQrImages();
    api.get<ApiResponse<{ mode: Exclude<PayPalMode, "Unavailable"> }>>(`${endpoints.adminSettings}?action=payment_mode`)
      .then((res) => {
        if (res.data.type === "success" && res.data.data) setPaymentMode(res.data.data.mode);
      })
      .catch(() => setPaymentMode("Unavailable"));
  }, [userId, reloadGcashQrImages, loadChatbotFaqs, loadChatbotSuggestedQuestions, updateApiKeys, toast]);

  useEffect(() => {
    if (liveProfile) setProfile(liveProfile);
  }, [liveProfile]);

  useEffect(() => {
    if (liveSettings) setSettings(liveSettings);
  }, [liveSettings]);

  useEffect(() => {
    if (livePaymentMode?.mode) setPaymentMode(livePaymentMode.mode);
  }, [livePaymentMode]);

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await saveMyAdminSettingsProfile(profile);
      const emailChangeRequested = await requestAdminEmailChange(profile.email);
      toast({
        title: emailChangeRequested ? "Profile saved; confirm your email change" : "Profile saved",
        description: emailChangeRequested ? "Check your inbox to confirm the new sign-in email." : undefined,
      });
    } catch (error) {
      toast({
        title: "Unable to save administrator profile",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveChatbotFaq = async () => {
    setChatbotFaqSaving(true);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=save_chatbot_faq`,
        chatbotFaqForm,
      );
      if (res.data.type !== "success") {
        toast({ title: res.data.message ?? "Unable to save chatbot FAQ", variant: "destructive" });
        return;
      }
      toast({ title: res.data.message ?? "Chatbot FAQ saved" });
      setChatbotFaqForm(newChatbotFaq());
      await loadChatbotFaqs();
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to save chatbot FAQ",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setChatbotFaqSaving(false);
    }
  };

  const deleteChatbotFaq = async (faqId: number) => {
    setChatbotFaqDeleting(faqId);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=delete_chatbot_faq`,
        { faq_id: faqId },
      );
      if (res.data.type !== "success") {
        toast({ title: res.data.message ?? "Unable to delete chatbot FAQ", variant: "destructive" });
        return;
      }
      toast({ title: res.data.message ?? "Chatbot FAQ deleted" });
      if (chatbotFaqForm.faq_id === faqId) setChatbotFaqForm(newChatbotFaq());
      await loadChatbotFaqs();
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to delete chatbot FAQ",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setChatbotFaqDeleting(null);
    }
  };

  const saveChatbotSuggestedQuestion = async () => {
    const question = chatbotSuggestedQuestion.trim();
    if (!question) return;
    const editingId = chatbotSuggestedQuestionEditing;
    setChatbotSuggestedQuestionSaving(true);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=save_chatbot_suggested_question`,
        { question, ...(editingId !== null ? { suggested_question_id: editingId } : {}) },
      );
      if (res.data.type !== "success") {
        toast({ title: res.data.message ?? "Unable to save suggested question", variant: "destructive" });
        return;
      }
      toast({ title: res.data.message ?? (editingId !== null ? "Suggested question updated" : "Suggested question added") });
      setChatbotSuggestedQuestion("");
      setChatbotSuggestedQuestionEditing(null);
      await loadChatbotSuggestedQuestions();
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to save suggested question",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setChatbotSuggestedQuestionSaving(false);
    }
  };

  const editChatbotSuggestedQuestion = (item: ChatbotSuggestedQuestion) => {
    setChatbotSuggestedQuestionEditing(item.suggested_question_id);
    setChatbotSuggestedQuestion(item.question);
  };

  const cancelChatbotSuggestedQuestionEdit = () => {
    setChatbotSuggestedQuestionEditing(null);
    setChatbotSuggestedQuestion("");
  };

  const deleteChatbotSuggestedQuestion = async (suggestedQuestionId: number) => {
    setChatbotSuggestedQuestionDeleting(suggestedQuestionId);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=delete_chatbot_suggested_question`,
        { suggested_question_id: suggestedQuestionId },
      );
      if (res.data.type !== "success") {
        toast({ title: res.data.message ?? "Unable to delete suggested question", variant: "destructive" });
        return;
      }
      toast({ title: res.data.message ?? "Suggested question deleted" });
      if (chatbotSuggestedQuestionEditing === suggestedQuestionId) {
        cancelChatbotSuggestedQuestionEdit();
      }
      await loadChatbotSuggestedQuestions();
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to delete suggested question",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setChatbotSuggestedQuestionDeleting(null);
    }
  };

  const changePassword = async () => {
    if (!profile) return;
    try {
      await changeMyPassword(pw.current_password, pw.new_password);
      toast({ title: "Password updated" });
      setPw({ current_password: "", new_password: "" });
    } catch (error) {
      toast({
        title: "Unable to update password",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const saveSettingsGroup = async (
    groupName: string,
    values: Record<string, string | boolean>,
    setGroupSaving: (isSaving: boolean) => void,
  ): Promise<boolean> => {
    setGroupSaving(true);
    try {
      const response = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=update_settings`,
        values,
      );
      if (response.data.type !== "success") {
        throw new Error(response.data.message ?? `Unable to save ${groupName}`);
      }
      toast({ title: response.data.message ?? `${groupName} saved` });
      return true;
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: `Unable to save ${groupName}`,
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
      return false;
    } finally {
      setGroupSaving(false);
    }
  };

  const saveHouseSettings = async () => {
    const keys = [
      "house_address_line_1",
      "house_address_line_2",
      "house_contact_phone",
      "house_contact_email",
    ];
    const values = Object.fromEntries(keys.map(key => [key, settingText(key)]));
    await saveSettingsGroup("House Contact Info", values, setHouseSaving);
  };

  const saveGpsSettings = async () => {
    const latitude = Number(settingText("house_map_lat"));
    const longitude = Number(settingText("house_map_lng"));
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      toast({
        title: "Invalid GPS coordinates",
        description: "Latitude must be between -90 and 90, and longitude must be between -180 and 180.",
        variant: "destructive",
      });
      return;
    }
    await saveSettingsGroup("GPS Mapping Settings", {
      house_map_lat: String(latitude),
      house_map_lng: String(longitude),
    }, setGpsSaving);
  };

  const saveOfficeHours = async () => {
    const weekdayOpen = settingTextOrDefault("house_weekday_open_time", "08:00");
    const weekdayClose = settingTextOrDefault("house_weekday_close_time", "18:00");
    const weekendOpen = settingTextOrDefault("house_weekend_open_time", "08:00");
    const weekendClose = settingTextOrDefault("house_weekend_close_time", "18:00");
    const isValidRange = (open: string, close: string) => /^\d{2}:\d{2}$/.test(open)
      && /^\d{2}:\d{2}$/.test(close)
      && open < close;
    if (!isValidRange(weekdayOpen, weekdayClose)
      || (!settingEnabled("house_weekend_by_appointment", true) && !isValidRange(weekendOpen, weekendClose))) {
      toast({
        title: "Invalid office hours",
        description: "Choose a valid opening and closing time. The closing time must be later than the opening time.",
        variant: "destructive",
      });
      return;
    }
    await saveSettingsGroup("Office Hours", {
      house_weekday_open_time: weekdayOpen,
      house_weekday_close_time: weekdayClose,
      house_weekend_open_time: weekendOpen,
      house_weekend_close_time: weekendClose,
      house_weekend_by_appointment: settingEnabled("house_weekend_by_appointment", true),
    }, setHouseSaving);
  };

  const saveTextbeeSettings = async () => {
    const keys = ["textbee_api_base", "textbee_device_id", "sms_default_country_code", "registration_sms_otp_enabled"];
    const values: Record<string, string | boolean> = Object.fromEntries(
      keys.map(key => [key, settingText(key)]),
    );
    values.textbee_api_key = apiKeys.textbee_api_key;
    await saveSettingsGroup("TextBee settings", values, setTextbeeSaving);
  };

  const savePaypalSettings = async () => {
    const saved = await saveSettingsGroup("PayPal API Credentials", {
      paypal_client_id: apiKeys.paypal_client_id,
      paypal_secret: apiKeys.paypal_secret,
      paypal_webhook_id: apiKeys.paypal_webhook_id,
    }, setPaypalSaving);
    if (saved) {
      try {
        await updateApiKeys();
      } catch (error: unknown) {
        toast({
          title: "PayPal credentials saved, but could not refresh their display",
          description: error instanceof Error ? error.message : "An unexpected error occurred",
          variant: "destructive",
        });
      }
    }
  };

  const saveOllamaApiKey = async () => {
    const apiKey = apiKeys.ollama_api_key.trim();
    if (!apiKey) {
      toast({ title: "Enter an Ollama API key", variant: "destructive" });
      return;
    }

    setOllamaKeySaving(true);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=update_ollama_api_key`,
        { api_key: apiKey },
      );
      if (res.data.type !== "success") {
        toast({ title: res.data.message ?? "Unable to save Ollama API key", variant: "destructive" });
        return;
      }
      setSettings(current => ({
        ...current,
        ollama_api_key: "",
        ollama_api_key_is_set: true,
      }));
      toast({ title: res.data.message ?? "Ollama API key saved" });
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "Unable to save Ollama API key",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setOllamaKeySaving(false);
    }
  };

  const uploadGcashQr = async () => {
    if (!qrFile) return;
    const amount = Number(qrAmount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      toast({ title: "Enter a valid fixed amount for this GCash QR", variant: "destructive" });
      return;
    }
    setQrUploading(true);
    try {
      const formData = new FormData();
      formData.append("gcash_qr", await cropGcashQr(qrFile));
      formData.append("amount", String(amount));
      const res = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=upload_gcash_qr`,
        formData,
        { headers: { "Content-Type": undefined } },
      );
      if (res.data.type !== "success") {
        toast({ title: res.data.message ?? "GCash QR upload failed", variant: "destructive" });
        return;
      }
      await reloadGcashQrImages();
      setQrFile(null);
      setQrAmount("");
      if (qrInputRef.current) qrInputRef.current.value = "";
      toast({ title: res.data.message ?? "GCash QR added" });
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "GCash QR upload failed",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setQrUploading(false);
    }
  };

  const saveGcashQrAmount = async (image: GcashQrImage) => {
    const amount = Number(qrAmountDrafts[image.filename]);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      toast({ title: "Enter a valid fixed amount for this GCash QR", variant: "destructive" });
      return;
    }
    setQrAmountSaving(image.filename);
    try {
      const response = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=update_gcash_qr`,
        { filename: image.filename, amount },
      );
      if (response.data.type !== "success") {
        throw new Error(response.data.message || "Could not save the GCash QR amount");
      }
      await reloadGcashQrImages();
      toast({ title: response.data.message || "GCash QR fixed amount saved" });
    } catch (error) {
      toast({
        title: "Unable to save GCash QR amount",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setQrAmountSaving(null);
    }
  };

  const cropSavedGcashQrs = async () => {
    if (qrImages.length === 0) return;
    setQrCropping(true);
    setQrCropProgress("");
    let croppedCount = 0;
    const failures: string[] = [];
    try {
      for (const [index, image] of qrImages.entries()) {
        setQrCropProgress(`Cropping ${index + 1} of ${qrImages.length}…`);
        try {
          const response = await fetch(
            `${endpoints.adminSettings}?action=get_gcash_qr_image&filename=${encodeURIComponent(image.filename)}`,
            { credentials: "include" },
          );
          if (!response.ok) throw new Error(`Could not load ${image.filename}`);
          const sourceBlob = await response.blob();
          const sourceFile = new File([sourceBlob], image.filename, { type: sourceBlob.type });
          const croppedFile = await cropGcashQr(sourceFile);
          const formData = new FormData();
          formData.append("filename", image.filename);
          formData.append("gcash_qr", croppedFile);
          const result = await api.post<ApiResponse>(
            `${endpoints.adminSettings}?action=crop_gcash_qr`,
            formData,
            { headers: { "Content-Type": undefined } },
          );
          if (result.data.type !== "success") {
            throw new Error(result.data.message ?? `Could not save cropped image ${image.filename}`);
          }
          croppedCount += 1;
        } catch (error: unknown) {
          const detail = error instanceof Error ? error.message : "Unexpected error";
          failures.push(`${image.filename}: ${detail}`);
        }
      }

      await reloadGcashQrImages();
      if (failures.length > 0) {
        toast({
          title: `Cropped ${croppedCount} of ${qrImages.length} GCash QR images`,
          description: failures.join("; "),
          variant: "destructive",
        });
      } else {
        toast({ title: `Cropped all ${croppedCount} GCash QR images` });
      }
    } finally {
      setQrCropping(false);
      setQrCropProgress("");
    }
  };

  const deleteGcashQr = async () => {
    if (!qrToDelete) return;
    setQrDeleting(true);
    try {
      const res = await api.post<ApiResponse>(
        `${endpoints.adminSettings}?action=delete_gcash_qr`,
        { filename: qrToDelete.filename },
      );
      if (res.data.type !== "success") {
        toast({ title: res.data.message ?? "GCash QR deletion failed", variant: "destructive" });
        return;
      }
      toast({ title: res.data.message ?? "GCash QR deleted" });
      setQrToDelete(null);
      await reloadGcashQrImages();
    } catch (error: unknown) {
      const message = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined;
      toast({
        title: "GCash QR deletion failed",
        description: message || (error instanceof Error ? error.message : "An unexpected error occurred"),
        variant: "destructive",
      });
    } finally {
      setQrDeleting(false);
    }
  };

  if (!userId) return (
    <DashboardLayout role="admin">
      <div className="p-4 rounded-md border border-warning/30 bg-warning/10 text-warning text-sm">Sign in to view settings.</div>
    </DashboardLayout>
  );
  if (loading) return (
    <DashboardLayout role="admin">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="font-display text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Configure house information, office hours, payment options, and system integrations.</p>
        </div>

        {profile && <ProfilePictureCard userId={profile.user_id} currentPath={profile.profile_picture} storageBacked onUploaded={async () => {
          setProfile({ ...await getMyAdminSettingsProfile(), user_type: "Admin" });
        }} />}

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div>
            <h2 className="font-semibold">GCash Payment QR</h2>
            <p className="text-sm text-muted-foreground mt-1">Upload fixed-amount GCash QR images. Guests and tenants can view the saved QR codes. JPG, PNG, or WEBP, up to 10MB.</p>
          </div>
          <div className="grid gap-1.5 max-w-xs">
            <Label htmlFor="gcash-qr-fixed-amount">Fixed amount (₱)</Label>
            <Input
              id="gcash-qr-fixed-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={qrAmount}
              onChange={event => setQrAmount(event.target.value)}
              placeholder="e.g. 4000"
            />
          </div>
          <Input
            ref={qrInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={event => {
              const file = event.target.files?.[0] ?? null;
              if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
                toast({ title: "Choose a JPG, PNG, or WEBP image up to 10MB", variant: "destructive" });
                event.target.value = "";
                setQrFile(null);
                return;
              }
              setQrFile(file);
            }}
          />
          <Button onClick={uploadGcashQr} disabled={!qrFile || !qrAmount || qrUploading || qrCropping}>
            {qrUploading ? "Uploading…" : "Upload GCash QR"}
          </Button>
          {qrImages.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Crop previously uploaded images into square, scan-friendly QR codes. New uploads are cropped automatically.
              </p>
              <Button
                variant="outline"
                onClick={() => void cropSavedGcashQrs()}
                disabled={qrCropping || qrUploading}
              >
                {qrCropping
                  ? <><Loader2 size={14} className="mr-2 animate-spin" />{qrCropProgress}</>
                  : "Crop existing QR images"}
              </Button>
            </div>
          )}
          <div className="border-t border-border pt-4">
            <h3 className="font-medium mb-3">Uploaded GCash QR images</h3>
            {qrImagesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading QR images…</div>
            ) : qrImages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No GCash QR images have been uploaded.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {qrImages.map(image => (
                  <div key={image.filename} className="space-y-3 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between rounded-md bg-primary/5 px-3 py-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fixed amount</span>
                      <span className="font-display font-bold text-primary">
                        {image.amount === null ? "Not set" : `₱${Number(image.amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`}
                      </span>
                    </div>
                    <img
                      src={`${API_BASE_URL}/${image.path}`}
                      alt={image.amount === null ? "GCash QR with fixed amount not set" : `GCash QR for ₱${Number(image.amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`}
                      className="w-full aspect-square rounded-md border bg-white object-contain p-1"
                    />
                    <div className="grid gap-1.5">
                      <Label htmlFor={`qr-amount-${image.filename}`} className="text-xs">Set or change amount (₱)</Label>
                      <Input
                        id={`qr-amount-${image.filename}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={qrAmountDrafts[image.filename] ?? ""}
                        onChange={event => setQrAmountDrafts(current => ({ ...current, [image.filename]: event.target.value }))}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={qrAmountSaving === image.filename}
                        onClick={() => void saveGcashQrAmount(image)}
                      >
                        {qrAmountSaving === image.filename ? <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</> : "Save amount"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        aria-label={`Delete GCash QR ${image.filename}`}
                        disabled={qrDeleting || qrCropping}
                        onClick={() => setQrToDelete(image)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <h2 className="font-semibold">Chatbot Suggested Questions</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Add question-only prompts for the public chatbot. When selected, each prompt is sent to the AI to answer; no saved answer is required.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={chatbotSuggestedQuestion}
              maxLength={255}
              onChange={event => setChatbotSuggestedQuestion(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveChatbotSuggestedQuestion();
                }
              }}
              placeholder={chatbotSuggestedQuestionEditing !== null ? "Edit suggested question" : "Example: What should I bring when moving in?"}
              aria-label="Suggested question"
            />
            <Button
              type="button"
              className="gap-2"
              disabled={chatbotSuggestedQuestionSaving || !chatbotSuggestedQuestion.trim()}
              onClick={() => void saveChatbotSuggestedQuestion()}
            >
              {chatbotSuggestedQuestionSaving
                ? <Loader2 size={14} className="animate-spin" />
                : chatbotSuggestedQuestionEditing !== null ? <Pencil size={14} /> : <Plus size={14} />}
              {chatbotSuggestedQuestionEditing !== null ? "Save Changes" : "Add Question"}
            </Button>
            {chatbotSuggestedQuestionEditing !== null && (
              <Button type="button" variant="outline" onClick={cancelChatbotSuggestedQuestionEdit}>
                Cancel
              </Button>
            )}
          </div>
          <div className="border-t border-border pt-4 space-y-3">
            <h3 className="font-medium">Saved Suggested Questions</h3>
            {chatbotSuggestedQuestionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading suggested questions…</div>
            ) : chatbotSuggestedQuestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suggested questions yet.</p>
            ) : (
              <div className="space-y-2">
                {chatbotSuggestedQuestions.map(item => (
                  <div key={item.suggested_question_id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                    <p className="text-sm">{item.question}</p>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={chatbotSuggestedQuestionSaving || chatbotSuggestedQuestionDeleting === item.suggested_question_id}
                        onClick={() => editChatbotSuggestedQuestion(item)}
                      >
                        <Pencil size={14} />
                        <span className="sr-only">Edit suggested question</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={chatbotSuggestedQuestionDeleting === item.suggested_question_id}
                        aria-label="Delete suggested question"
                        onClick={() => void deleteChatbotSuggestedQuestion(item.suggested_question_id)}
                      >
                        {chatbotSuggestedQuestionDeleting === item.suggested_question_id ? "Deleting…" : <Trash2 size={14} />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <h2 className="font-semibold">Public Chatbot FAQs</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Active answers guide the public chatbot for rates, available rooms, house rules, payment methods, reservations, and location. Live room rates and availability still come from the rooms database.
            </p>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="chatbot-faq-category">Category</Label>
              <select
                id="chatbot-faq-category"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={chatbotFaqForm.category}
                onChange={event => setChatbotFaqForm(current => ({ ...current, category: event.target.value as ChatbotFaqCategory }))}
              >
                {chatbotFaqCategories.map(category => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="chatbot-faq-question">Question</Label>
              <Input
                id="chatbot-faq-question"
                maxLength={255}
                value={chatbotFaqForm.question}
                onChange={event => setChatbotFaqForm(current => ({ ...current, question: event.target.value }))}
                placeholder="Example: What payment methods do you accept?"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="chatbot-faq-answer">Approved answer</Label>
              <Textarea
                id="chatbot-faq-answer"
                maxLength={5000}
                rows={4}
                value={chatbotFaqForm.answer}
                onChange={event => setChatbotFaqForm(current => ({ ...current, answer: event.target.value }))}
                placeholder="Write the answer the chatbot should use for this FAQ."
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chatbotFaqForm.is_active}
                onChange={event => setChatbotFaqForm(current => ({ ...current, is_active: event.target.checked }))}
              />
              Use this FAQ in chatbot answers
            </label>
            <div className="flex gap-2">
              <Button
                onClick={saveChatbotFaq}
                disabled={chatbotFaqSaving || !chatbotFaqForm.question.trim() || !chatbotFaqForm.answer.trim()}
              >
                {chatbotFaqSaving ? "Saving…" : chatbotFaqForm.faq_id ? "Update FAQ" : "Add FAQ"}
              </Button>
              {chatbotFaqForm.faq_id !== null && (
                <Button type="button" variant="outline" onClick={() => setChatbotFaqForm(newChatbotFaq())}>
                  Cancel Edit
                </Button>
              )}
            </div>
          </div>
          <div className="border-t border-border pt-4 space-y-3">
            <h3 className="font-medium">Saved FAQs</h3>
            {chatbotFaqsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading FAQs…</div>
            ) : chatbotFaqs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No FAQs yet. Add approved answers above; active entries are used by the chatbot.</p>
            ) : (
              <div className="space-y-2">
                {chatbotFaqs.map(faq => (
                  <div key={faq.faq_id} className="rounded-md border border-border p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {chatbotFaqCategories.find(category => category.value === faq.category)?.label ?? faq.category}
                        {faq.is_active ? "" : " · Inactive"}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setChatbotFaqForm({
                            faq_id: faq.faq_id,
                            category: faq.category,
                            question: faq.question,
                            answer: faq.answer,
                            is_active: faq.is_active === 1,
                          })}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={chatbotFaqDeleting === faq.faq_id}
                          onClick={() => void deleteChatbotFaq(faq.faq_id)}
                        >
                          {chatbotFaqDeleting === faq.faq_id ? "Deleting…" : "Delete"}
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm font-medium">{faq.question}</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{faq.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Profile</h2>
          {profile && <>
            <div className="grid gap-1.5"><Label>Username</Label>
              <Input value={profile.username} readOnly /></div>
            <div className="grid gap-1.5"><Label>Full name</Label>
              <Input value={profile.full_name} onChange={e => setProfile({ ...profile, full_name: e.target.value })} /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Email</Label>
                <Input value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Phone</Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  value={profile.phone ?? ""}
                  onChange={e => setProfile({ ...profile, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                /></div>
            </div>
            <Button onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save Profile"}</Button>
          </>}
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Change Password</h2>
          <div className="grid gap-1.5"><Label htmlFor="admin-current-password">Current</Label>
            <div className="flex gap-2">
              <Input id="admin-current-password" type={visiblePasswordFields.current ? "text" : "password"} autoComplete="current-password" value={pw.current_password} onChange={e => setPw({ ...pw, current_password: e.target.value })} />
              <Button type="button" variant="outline" size="icon" aria-label={visiblePasswordFields.current ? "Hide current password" : "Show current password"} aria-pressed={visiblePasswordFields.current} onClick={() => setVisiblePasswordFields(current => ({ ...current, current: !current.current }))}>
                {visiblePasswordFields.current ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="admin-new-password">New (min 6 chars)</Label>
            <div className="flex gap-2">
              <Input id="admin-new-password" type={visiblePasswordFields.next ? "text" : "password"} autoComplete="new-password" value={pw.new_password} onChange={e => setPw({ ...pw, new_password: e.target.value })} />
              <Button type="button" variant="outline" size="icon" aria-label={visiblePasswordFields.next ? "Hide new password" : "Show new password"} aria-pressed={visiblePasswordFields.next} onClick={() => setVisiblePasswordFields(current => ({ ...current, next: !current.next }))}>
                {visiblePasswordFields.next ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <Button onClick={changePassword}>Update Password</Button>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">House Contact Info</h2>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Address line 1</Label>
              <Input value={settingText("house_address_line_1")} onChange={e => setSettings({ ...settings, house_address_line_1: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Address line 2</Label>
              <Input value={settingText("house_address_line_2")} onChange={e => setSettings({ ...settings, house_address_line_2: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>Contact phone</Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="09XXXXXXXXX"
                  value={settingText("house_contact_phone")}
                  onChange={e => setSettings({ ...settings, house_contact_phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                /></div>
              <div className="grid gap-1.5"><Label>Contact email</Label>
                <Input value={settingText("house_contact_email")} onChange={e => setSettings({ ...settings, house_contact_email: e.target.value })} /></div>
            </div>
            <Button onClick={saveHouseSettings} disabled={houseSaving}>
              {houseSaving ? "Saving…" : "Save House Info"}
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <h2 className="font-semibold">Office Hours</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Set the opening and closing times shown to visitors and in the AI chatbot.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3 rounded-md border border-border p-4">
              <h3 className="font-medium">Weekdays (Monday–Friday)</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="house-weekday-open">Opens</Label>
                  <Input
                    id="house-weekday-open"
                    type="time"
                    value={settingTextOrDefault("house_weekday_open_time", "08:00")}
                    onChange={e => setSettings({ ...settings, house_weekday_open_time: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="house-weekday-close">Closes</Label>
                  <Input
                    id="house-weekday-close"
                    type="time"
                    value={settingTextOrDefault("house_weekday_close_time", "18:00")}
                    onChange={e => setSettings({ ...settings, house_weekday_close_time: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">Weekends (Saturday–Sunday)</h3>
                <div className="flex items-center gap-2">
                  <Label htmlFor="house-weekend-appointment" className="text-sm">By appointment</Label>
                  <Switch
                    id="house-weekend-appointment"
                    checked={settingEnabled("house_weekend_by_appointment", true)}
                    onCheckedChange={checked => setSettings({ ...settings, house_weekend_by_appointment: checked })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="house-weekend-open">Opens</Label>
                  <Input
                    id="house-weekend-open"
                    type="time"
                    disabled={settingEnabled("house_weekend_by_appointment", true)}
                    value={settingTextOrDefault("house_weekend_open_time", "08:00")}
                    onChange={e => setSettings({ ...settings, house_weekend_open_time: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="house-weekend-close">Closes</Label>
                  <Input
                    id="house-weekend-close"
                    type="time"
                    disabled={settingEnabled("house_weekend_by_appointment", true)}
                    value={settingTextOrDefault("house_weekend_close_time", "18:00")}
                    onChange={e => setSettings({ ...settings, house_weekend_close_time: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
          <Button onClick={saveOfficeHours} disabled={houseSaving}>
            {houseSaving ? "Saving…" : "Save Office Hours"}
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">GPS Mapping Settings</h2>
          <p className="text-sm text-muted-foreground">
            Set the coordinates used to display the boarding house location on the map.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="house-map-lat">Map latitude</Label>
              <Input
                id="house-map-lat"
                type="number"
                min="-90"
                max="90"
                step="any"
                value={settingText("house_map_lat")}
                onChange={e => setSettings({ ...settings, house_map_lat: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="house-map-lng">Map longitude</Label>
              <Input
                id="house-map-lng"
                type="number"
                min="-180"
                max="180"
                step="any"
                value={settingText("house_map_lng")}
                onChange={e => setSettings({ ...settings, house_map_lng: e.target.value })}
              />
            </div>
          </div>
          <Button onClick={saveGpsSettings} disabled={gpsSaving}>
            {gpsSaving ? "Saving…" : "Save GPS Settings"}
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <div className="pt-4 border-t border-border space-y-3">
            <h2 className="font-semibold">Ollama Cloud Settings</h2>
            <p className="text-sm text-muted-foreground">
              The saved key loads masked; use the eye button to view it. This field can replace the key. A server OLLAMA_API_KEY environment variable takes precedence over the database value.
            </p>
            {apiKeyField("Ollama API key", "ollama_api_key", true)}
            <Button onClick={saveOllamaApiKey} disabled={ollamaKeySaving || !apiKeys.ollama_api_key.trim()}>
              {ollamaKeySaving ? "Saving…" : "Save Ollama Settings"}
            </Button>
          </div>
          <div className="pt-4 border-t border-border space-y-3">
            <h2 className="font-semibold">TextBee SMS Settings</h2>
            {apiKeyField("TextBee API key", "textbee_api_key", true)}
            <div className="grid gap-1.5"><Label>TextBee API base</Label>
              <Input value={settingText("textbee_api_base")} onChange={e => setSettings({ ...settings, textbee_api_base: e.target.value })} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="textbee-device-id">TextBee device ID (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="textbee-device-id"
                  type={visibleTextbeeDeviceId ? "text" : "password"}
                  autoComplete="off"
                  value={settingText("textbee_device_id")}
                  onChange={e => setSettings({ ...settings, textbee_device_id: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`${visibleTextbeeDeviceId ? "Hide" : "Show"} TextBee device ID`}
                  aria-pressed={visibleTextbeeDeviceId}
                  onClick={() => setVisibleTextbeeDeviceId(visible => !visible)}
                >
                  {visibleTextbeeDeviceId ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5"><Label>Default country code</Label>
              <Input value={settingText("sms_default_country_code")} onChange={e => setSettings({ ...settings, sms_default_country_code: e.target.value })} /></div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div className="space-y-1">
                <Label htmlFor="registration-sms-otp">Registration SMS OTP</Label>
                <p className="text-xs text-muted-foreground">When off, registration uses a generated mock OTP instead of TextBee.</p>
              </div>
              <Switch
                id="registration-sms-otp"
                checked={settings.registration_sms_otp_enabled === "1"}
                onCheckedChange={checked => setSettings({ ...settings, registration_sms_otp_enabled: checked ? "1" : "0" })}
                aria-label="Enable registration SMS OTP"
              />
            </div>
            <Button onClick={saveTextbeeSettings} disabled={textbeeSaving}>
              {textbeeSaving ? "Saving…" : "Save TextBee Settings"}
            </Button>
          </div>
          <div className="pt-4 border-t border-border space-y-3">
            <h2 className="font-semibold">PayPal API Credentials</h2>
            <p className="text-sm text-muted-foreground">
              PayPal mode: {paymentMode ?? "Loading"}
            </p>
            <p className="text-sm text-muted-foreground">
              Values saved here are used when server environment and backend/Config/secrets.php credentials are not configured.
            </p>
            {apiKeyField("PayPal Client ID", "paypal_client_id", true)}
            {apiKeyField("PayPal Secret", "paypal_secret", true)}
            {apiKeyField("PayPal Webhook ID", "paypal_webhook_id", true)}
            <Button onClick={savePaypalSettings} disabled={paypalSaving}>
              {paypalSaving ? "Saving…" : "Save Paypal Settings"}
            </Button>
          </div>
        </div>
      </div>
      <AlertDialog open={qrToDelete !== null} onOpenChange={open => { if (!open && !qrDeleting) setQrToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete GCash QR image?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the selected QR image. If it is currently used for payments, tenants and guests will no longer see a payment QR until another one is uploaded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={qrDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={qrDeleting}
              onClick={event => {
                event.preventDefault();
                void deleteGcashQr();
              }}
            >
              {qrDeleting ? "Deleting…" : "Delete QR"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default AdminSettings;
