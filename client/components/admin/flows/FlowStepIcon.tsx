import { Bell, CircleStop, Clock, GitBranch, Mail, MessageSquare, MessageSquareReply, Archive, Zap } from "lucide-react";
import type { FlowStepType } from "@shared/api";

const ICONS: Record<FlowStepType, typeof Zap> = {
  trigger: Zap,
  wait: Clock,
  send_email: Mail,
  send_sms: MessageSquare,
  notify_staff: Bell,
  condition: GitBranch,
  wait_for_reply: MessageSquareReply,
  close: Archive,
  end: CircleStop,
};

export function FlowStepIcon({ type, size = 15 }: { type: FlowStepType; size?: number }) {
  const Icon = ICONS[type] || Zap;
  return <Icon size={size} />;
}
