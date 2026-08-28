import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { SentenceStructure } from '../../types';
import { C, S } from '../../utils/theme';

interface SentenceStructureDiagramProps {
  structure: SentenceStructure;
}

const NODE_GAP = 26;
const NODE_Y = 82;
const NODE_HEIGHT = 66;
const SIDE_PADDING = 28;

const palette = [
  { fill: '#F0EDFF', stroke: '#8D7CF7', label: '#735EF0' },
  { fill: '#EAF8F4', stroke: '#63C5A7', label: '#259473' },
  { fill: '#FFF0F7', stroke: '#E78ABC', label: '#C55391' },
  { fill: '#EDF5FF', stroke: '#78A9F7', label: '#4A84DB' },
];

function splitText(value: string, maxLength = 12): string[] {
  const text = value.trim();
  if (text.length <= maxLength) return [text];
  const words = text.split(/\s+/);
  if (words.length > 1) {
    const lines: string[] = [];
    let line = '';
    words.forEach(word => {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxLength && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.slice(0, 2);
  }
  return [text.slice(0, maxLength), text.slice(maxLength, maxLength * 2)];
}

export default function SentenceStructureDiagram({ structure }: SentenceStructureDiagramProps) {
  const { width: windowWidth } = useWindowDimensions();
  const segments = structure.segments.filter(segment => segment.text.trim());
  if (!segments.length) return null;

  const nodes = segments.map((segment, index) => {
    const lines = splitText(segment.text);
    const longest = Math.max(...lines.map(line => line.length), segment.meaning.length);
    const width = Math.min(184, Math.max(116, longest * 13 + 34));
    return { segment, index, lines, width };
  });
  let cursor = SIDE_PADDING;
  const positioned = nodes.map(node => {
    const x = cursor;
    cursor += node.width + NODE_GAP;
    return { ...node, x };
  });
  const contentWidth = Math.max(windowWidth - 36, cursor - NODE_GAP + SIDE_PADDING);
  const canvasHeight = 292;
  const first = positioned[0];
  const last = positioned[positioned.length - 1];

  return (
    <View style={[S.bgSurface2, S.roundedSM, { overflow: 'hidden' }]}>
      <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
        <Text style={[S.textXs, S.textAccent, S.semibold]}>句子成分与结构</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={contentWidth > windowWidth - 36}>
        <Svg width={contentWidth} height={canvasHeight}>
          <G>
            <Rect x={SIDE_PADDING} y={18} rx={7} width={Math.min(contentWidth - SIDE_PADDING * 2, Math.max(150, (structure.pattern || '韩语句子结构').length * 14 + 28))} height={32} fill="#5BB675" />
            <SvgText x={SIDE_PADDING + 14} y={40} fontSize={15} fontWeight="700" fill="#FFFFFF">{structure.pattern || '韩语句子结构'}</SvgText>
            <Line x1={SIDE_PADDING} y1={61} x2={contentWidth - SIDE_PADDING} y2={61} stroke="#BFE4C8" strokeWidth={3} />

            {positioned.map((node, index) => {
              const colors = palette[index % palette.length];
              const centerX = node.x + node.width / 2;
              const roleY = index % 2 === 0 ? 205 : 245;
              const roleWidth = Math.min(168, Math.max(86, node.segment.role.length * 12 + 26));
              return (
                <G key={`${node.segment.text}-${index}`}>
                  {index > 0 ? (
                    <Line
                      x1={positioned[index - 1].x + positioned[index - 1].width}
                      y1={NODE_Y + NODE_HEIGHT / 2}
                      x2={node.x}
                      y2={NODE_Y + NODE_HEIGHT / 2}
                      stroke="#D8D8E2"
                      strokeWidth={3}
                    />
                  ) : null}
                  <Rect x={node.x} y={NODE_Y} rx={10} width={node.width} height={NODE_HEIGHT} fill={colors.fill} stroke={colors.stroke} strokeWidth={2} />
                  {node.lines.map((line, lineIndex) => (
                    <SvgText key={lineIndex} x={centerX} y={node.lines.length === 1 ? NODE_Y + 28 : NODE_Y + 23 + lineIndex * 20} textAnchor="middle" fontSize={17} fontWeight="700" fill={C.text}>{line}</SvgText>
                  ))}
                  <SvgText x={centerX} y={NODE_Y + 54} textAnchor="middle" fontSize={12} fill={C.text2}>{node.segment.meaning}</SvgText>

                  <Path
                    d={`M ${centerX} ${NODE_Y + NODE_HEIGHT} L ${centerX} ${roleY - 24} L ${centerX + (index % 2 === 0 ? -20 : 20)} ${roleY - 8}`}
                    fill="none"
                    stroke={colors.stroke}
                    strokeWidth={2.5}
                  />
                  <Circle cx={centerX} cy={NODE_Y + NODE_HEIGHT} r={4} fill={colors.stroke} />
                  <Rect x={centerX - roleWidth / 2} y={roleY - 8} rx={7} width={roleWidth} height={30} fill={colors.label} />
                  <SvgText x={centerX} y={roleY + 12} textAnchor="middle" fontSize={13} fontWeight="700" fill="#FFFFFF">{node.segment.role}</SvgText>
                  {node.segment.note ? (
                    <SvgText x={centerX} y={roleY + 42} textAnchor="middle" fontSize={12} fill={C.text3}>{node.segment.note}</SvgText>
                  ) : null}
                </G>
              );
            })}

            <Line x1={first.x} y1={168} x2={last.x + last.width} y2={168} stroke="#AFCBFA" strokeWidth={3} />
            <Circle cx={first.x} cy={168} r={4} fill="#78A9F7" />
            <Circle cx={last.x + last.width} cy={168} r={4} fill="#78A9F7" />
          </G>
        </Svg>
      </ScrollView>
      {structure.natural ? (
        <View style={{ borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 14, paddingVertical: 12 }}>
          <Text style={[S.textXxs, S.text3, S.semibold]}>自然表达</Text>
          <Text selectable style={[S.textSm, S.text, { lineHeight: 22, marginTop: 4 }]}>{structure.natural}</Text>
        </View>
      ) : null}
    </View>
  );
}
